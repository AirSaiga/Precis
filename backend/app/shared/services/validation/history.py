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
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

HISTORY_FILENAME = "validation_history.json"
MAX_HISTORY_ENTRIES = 200


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
        """从磁盘加载历史记录"""
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

    def _save(self) -> None:
        """将历史记录写入磁盘"""
        self._file_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            with open(self._file_path, "w", encoding="utf-8") as f:
                json.dump({"runs": self._runs}, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.error(f"[ValidationHistory] 保存历史文件失败: {e}")

    def add_run(self, record: ValidationRunRecord) -> str:
        """添加一次校验记录，返回记录 ID"""
        entry = asdict(record)
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
        """删除单次记录"""
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


def generate_run_id() -> str:
    """生成运行 ID（含微秒保证唯一性）"""
    t = time.strftime("%Y%m%d_%H%M%S")
    us = int(time.time() * 1000000) % 1000000
    return f"run_{t}_{us:06d}"
