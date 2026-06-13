"""@fileoverview AI 异步任务持久化存储

功能概述:
- 将 AI 配置生成/迁移等异步任务的状态和 checkpoint 持久化到项目本地
- 支持后端重启后恢复未完成的任务
- 只保存关键 checkpoint 和 summary，不保存完整 LLM 历史，控制文件大小

架构设计:
- 每个 job 对应一个 JSON 文件：{config_path}/.precis/agent_jobs/{job_id}.json
- 文件内容包含 job 元数据、最新状态、最近 checkpoint、metrics
- 提供 save / load / list / cleanup / restore 接口

输入示例:
    storage = AgentJobStorage(config_path="/path/to/project")
    storage.save_checkpoint("job_abc", {
        "turn": 2,
        "config": {...},
        "metrics": {"total_rules": 10, "passed": 8},
    })

输出示例:
    checkpoint = storage.load_latest_checkpoint("job_abc")
    # {"turn": 2, "config": {...}, "metrics": {...}}
"""

from __future__ import annotations

import json
import logging
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# 单个 job 文件最大保留 checkpoint 数量
_MAX_CHECKPOINTS_PER_JOB = 10


class AgentJobStorage:
    """
    @classdesc AI 异步任务持久化存储

    按项目本地目录保存 job 状态和 checkpoint，不依赖外部数据库。
    """

    def __init__(self, config_path: str):
        """
        @methoddesc 初始化存储

        参数:
            config_path: 项目配置根目录
        """
        self.config_path = config_path
        self._jobs_dir = Path(config_path) / ".precis" / "agent_jobs"
        self._lock = threading.Lock()
        self._ensure_dir()

    def _ensure_dir(self) -> None:
        """确保 jobs 目录存在。"""
        try:
            self._jobs_dir.mkdir(parents=True, exist_ok=True)
        except OSError as e:
            logger.warning(f"创建 agent_jobs 目录失败: {e}")

    def _job_file_path(self, job_id: str) -> Path:
        """获取指定 job 的存储文件路径。"""
        return self._jobs_dir / f"{job_id}.json"

    def _load_raw(self, job_id: str) -> dict[str, Any]:
        """加载 job 原始数据，不存在则返回空字典。"""
        path = self._job_file_path(job_id)
        if not path.exists():
            return {}
        try:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict):
                return data
        except (json.JSONDecodeError, OSError) as e:
            logger.warning(f"读取 job 文件失败 {path}: {e}")
        return {}

    def _save_raw(self, job_id: str, data: dict[str, Any]) -> None:
        """保存 job 原始数据。"""
        self._ensure_dir()
        path = self._job_file_path(job_id)
        temp_path = path.with_suffix(".tmp")
        try:
            with open(temp_path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            os.replace(temp_path, path)
        except OSError as e:
            logger.warning(f"保存 job 文件失败 {path}: {e}")
            try:
                os.remove(temp_path)
            except OSError:
                pass

    def save_status(self, job_id: str, status: dict[str, Any]) -> None:
        """
        @methoddesc 保存 job 当前状态

        参数:
            job_id: 任务 ID
            status: 状态字典，需可 JSON 序列化
        """
        with self._lock:
            data = self._load_raw(job_id)
            data["job_id"] = job_id
            data["status"] = status
            data["updated_at"] = datetime.now(timezone.utc).isoformat()
            self._save_raw(job_id, data)

    def save_checkpoint(
        self,
        job_id: str,
        checkpoint: dict[str, Any],
        max_checkpoints: int = _MAX_CHECKPOINTS_PER_JOB,
    ) -> None:
        """
        @methoddesc 保存 job checkpoint

        参数:
            job_id: 任务 ID
            checkpoint: checkpoint 数据，需可 JSON 序列化
            max_checkpoints: 最多保留的 checkpoint 数量，超出时删除最旧的
        """
        with self._lock:
            data = self._load_raw(job_id)
            data["job_id"] = job_id
            checkpoints: list[dict[str, Any]] = data.get("checkpoints", [])
            checkpoint["saved_at"] = datetime.now(timezone.utc).isoformat()
            checkpoints.append(checkpoint)
            if len(checkpoints) > max_checkpoints:
                checkpoints = checkpoints[-max_checkpoints:]
            data["checkpoints"] = checkpoints
            data["updated_at"] = datetime.now(timezone.utc).isoformat()
            self._save_raw(job_id, data)

    def load_latest_checkpoint(self, job_id: str) -> dict[str, Any] | None:
        """
        @methoddesc 加载指定 job 最新的 checkpoint

        参数:
            job_id: 任务 ID

        返回:
            最新 checkpoint 字典，不存在则返回 None
        """
        with self._lock:
            data = self._load_raw(job_id)
            checkpoints = data.get("checkpoints", [])
            if checkpoints:
                return checkpoints[-1]
            return None

    def load_status(self, job_id: str) -> dict[str, Any] | None:
        """
        @methoddesc 加载指定 job 的当前状态

        参数:
            job_id: 任务 ID

        返回:
            状态字典，不存在则返回 None
        """
        with self._lock:
            data = self._load_raw(job_id)
            return data.get("status")

    def load_full(self, job_id: str) -> dict[str, Any]:
        """
        @methoddesc 加载指定 job 的完整数据

        参数:
            job_id: 任务 ID

        返回:
            完整 job 数据字典，不存在则只包含 job_id
        """
        with self._lock:
            data = self._load_raw(job_id)
            data.setdefault("job_id", job_id)
            return data

    def list_jobs(self) -> list[str]:
        """
        @methoddesc 列出所有持久化的 job ID

        返回:
            job ID 列表
        """
        self._ensure_dir()
        try:
            return [p.stem for p in self._jobs_dir.glob("*.json") if p.is_file()]
        except OSError as e:
            logger.warning(f"扫描 agent_jobs 目录失败: {e}")
            return []

    def cleanup_old_jobs(self, max_age_hours: float = 24.0) -> int:
        """
        @methoddesc 清理过旧的已完成 job 文件

        参数:
            max_age_hours: 最大保留时间（小时），默认 24 小时

        返回:
            清理的文件数量
        """
        self._ensure_dir()
        now = datetime.now(timezone.utc)
        removed = 0
        try:
            for path in self._jobs_dir.glob("*.json"):
                if not path.is_file():
                    continue
                try:
                    with open(path, encoding="utf-8") as f:
                        data = json.load(f)
                    status = data.get("status", {})
                    # 只清理已完成/失败/取消的任务
                    if status.get("status") not in ("completed", "failed", "cancelled"):
                        continue
                    updated_at = data.get("updated_at")
                    if not updated_at:
                        continue
                    updated = datetime.fromisoformat(updated_at)
                    elapsed_hours = (now - updated).total_seconds() / 3600.0
                    if elapsed_hours > max_age_hours:
                        os.remove(path)
                        removed += 1
                except Exception as e:
                    logger.warning(f"清理 job 文件失败 {path}: {e}")
        except OSError as e:
            logger.warning(f"扫描 agent_jobs 目录失败: {e}")
        return removed

    def delete_job(self, job_id: str) -> bool:
        """
        @methoddesc 删除指定 job 的持久化数据

        参数:
            job_id: 任务 ID

        返回:
            是否成功删除
        """
        with self._lock:
            path = self._job_file_path(job_id)
            if path.exists():
                try:
                    os.remove(path)
                    return True
                except OSError as e:
                    logger.warning(f"删除 job 文件失败 {path}: {e}")
            return False
