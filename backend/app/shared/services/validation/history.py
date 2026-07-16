"""@fileoverview 校验历史存储服务

功能概述:
- 将每次校验结果持久化到本地 JSON 文件
- 支持历史列表查询、单次详情查询、删除
- 支持聚合统计（趋势数据）

存储位置: {projectDir}/.precis/validation_history.json
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

HISTORY_FILENAME = "validation_history.json"
MAX_HISTORY_ENTRIES = 200

# 回归 C7: 进程级写锁。ValidationHistoryStore 每请求新建实例(load 全量→改→全量覆写),
# 并发请求会产生 lost-update。用模块级锁串行化同进程内的 add_run/delete_run 写操作,
# 避免互相覆盖(跨进程仍依赖文件锁,但本地单进程场景已足够)。
_history_write_lock = threading.Lock()


@dataclass
class ValidationRunRecord:
    """单次校验运行记录"""

    id: str
    timestamp: str
    duration_ms: int
    scope: str
    summary: dict[str, Any]
    by_type: dict[str, dict[str, int]]
    by_table: dict[str, dict[str, int]]
    errors: list[dict[str, Any]]
    warnings: list[str] = field(default_factory=list)


class ValidationHistoryStore:
    """校验历史持久化存储"""

    def __init__(self, project_dir: str) -> None:
        self._file_path = Path(project_dir) / ".precis" / HISTORY_FILENAME
        self._runs: list[dict[str, Any]] = []
        self._load()

    def _load(self) -> None:
        """从磁盘加载历史记录。

        回归 C7: 文件损坏时不应静默清空后用空列表覆写(否则下次 add_run 永久丢失全部
        历史)。这里把损坏文件重命名为 .corrupted 备份保留现场,内存置空但不破坏磁盘,
        便于用户手工恢复/排查。
        """
        if not self._file_path.exists():
            self._runs = []
            return
        try:
            with open(self._file_path, encoding="utf-8-sig") as f:
                data = json.load(f)
            self._runs = data.get("runs", [])
        except Exception as e:
            logger.warning(f"[ValidationHistory] 加载历史文件失败: {e}")
            self._runs = []
            # 把损坏文件备份为 .corrupted,避免下次保存静默清空现场(回归 C7)
            try:
                backup = self._file_path.with_suffix(self._file_path.suffix + ".corrupted")
                self._file_path.rename(backup)
                logger.warning(f"[ValidationHistory] 损坏的历史文件已备份至: {backup}")
            except OSError:
                # 重命名失败也不影响:构造阶段不写盘,损坏文件原样保留
                pass

    def _save(self) -> None:
        """将历史记录写入磁盘(原子写:tmp + os.replace)。

        回归 C7: 原实现直接以 "w" 打开目标文件,写一半崩溃/断电会留下截断损坏的 JSON,
        下次 _load 失败 → 清空 → 永久丢失全部历史。原子写保证目标文件要么是完整旧内容、
        要么是完整新内容,绝不出现部分写入。
        """
        self._file_path.parent.mkdir(parents=True, exist_ok=True)
        # 临时文件与目标同目录,保证 os.replace 是原子的(同文件系统)。
        tmp_path = self._file_path.with_suffix(self._file_path.suffix + ".tmp")
        try:
            with open(tmp_path, "w", encoding="utf-8") as f:
                json.dump({"runs": self._runs}, f, ensure_ascii=False, indent=2)
            os.replace(tmp_path, self._file_path)
        except Exception as e:
            logger.error(f"[ValidationHistory] 保存历史文件失败: {e}")
            # 清理可能残留的临时文件,避免堆积
            try:
                tmp_path.unlink()
            except OSError:
                pass

    def add_run(self, record: ValidationRunRecord) -> str:
        """添加一次校验记录，返回记录 ID。

        回归 C7: 加进程级写锁,串行化同进程内并发请求的 load→insert→save,
        避免互相覆盖(lost-update)。
        """
        entry = asdict(record)
        with _history_write_lock:
            self._runs.insert(0, entry)
            if len(self._runs) > MAX_HISTORY_ENTRIES:
                self._runs = self._runs[:MAX_HISTORY_ENTRIES]
            self._save()
        return record.id

    def get_runs(self, limit: int = 20, offset: int = 0) -> dict[str, Any]:
        """获取历史列表（分页）"""
        total = len(self._runs)
        items = self._runs[offset : offset + limit]
        return {"total": total, "limit": limit, "offset": offset, "items": items}

    def get_run(self, run_id: str) -> dict[str, Any] | None:
        """获取单次校验详情"""
        for run in self._runs:
            if run.get("id") == run_id:
                return run
        return None

    def delete_run(self, run_id: str) -> bool:
        """删除单次记录(回归 C7: 加写锁避免并发覆盖)。"""
        with _history_write_lock:
            original_len = len(self._runs)
            self._runs = [r for r in self._runs if r.get("id") != run_id]
            if len(self._runs) < original_len:
                self._save()
                return True
            return False

    def get_stats(self, last_n: int = 10) -> dict[str, Any]:
        """获取聚合统计（最近 N 次的趋势数据）"""
        recent = self._runs[:last_n]
        trend = []
        for run in reversed(recent):
            summary = run.get("summary", {})
            trend.append(
                {
                    "id": run.get("id"),
                    "timestamp": run.get("timestamp"),
                    "pass_rate": summary.get("pass_rate", 0),
                    "total_checks": summary.get("total_checks", 0),
                    "failed_count": summary.get("failed_count", 0),
                }
            )
        latest = self._runs[0] if self._runs else None
        return {
            "total_runs": len(self._runs),
            "trend": trend,
            "latest": {
                "pass_rate": latest.get("summary", {}).get("pass_rate", 0) if latest else 0,
                "total_checks": latest.get("summary", {}).get("total_checks", 0) if latest else 0,
                "passed_count": latest.get("summary", {}).get("passed_count", 0) if latest else 0,
                "failed_count": latest.get("summary", {}).get("failed_count", 0) if latest else 0,
                "timestamp": latest.get("timestamp") if latest else None,
            },
        }


_run_id_lock = threading.Lock()
_run_id_last_us: int = -1
_run_id_counter: int = 0


def generate_run_id() -> str:
    """生成运行 ID（时间戳 + 单调计数器保证唯一性）"""
    global _run_id_last_us, _run_id_counter
    t = time.strftime("%Y%m%d_%H%M%S")
    us = int(time.time() * 1000000) % 1000000
    with _run_id_lock:
        if us == _run_id_last_us:
            _run_id_counter += 1
        else:
            _run_id_last_us = us
            _run_id_counter = 0
        suffix = f"{us:06d}_{_run_id_counter:03d}"
    return f"run_{t}_{suffix}"
