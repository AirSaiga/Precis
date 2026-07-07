# backend/app/cli/shared_services/generation_ops.py
"""
@fileoverview 生成/迁移配置落盘共享逻辑（CLI/TUI 同源）

功能概述:
- 收敛 AI 配置生成与迁移的纯业务逻辑：生成结果落盘、数据文件扫描与展开
- 供 CLI 的 ai generate / ai migrate 命令与未来 TUI 的生成/迁移屏共同调用

架构设计:
- 本模块只含纯逻辑与文件 IO，不含任何 UI/交互
- apply_generated_config 复用 V2 配置写入约定（project.precis.yaml + schemas/ + constraints/ + regex/）
- scan_data_files 统一 patterns 展开与 data/ 目录扫描两种入口

接口契约（P0b 冻结）:
    def apply_generated_config(result: dict, project_path: str) -> list[str]
    def scan_data_files(patterns: list[str], project_path: str) -> list[str]
"""

from __future__ import annotations

import glob
import logging
import os
from pathlib import Path
from typing import Any

from app.shared.core.io.yaml import read_yaml, write_yaml

logger = logging.getLogger(__name__)

# 支持的文件扩展名（generate/migrate 共用）
SUPPORTED_EXTENSIONS = (".xlsx", ".xls", ".csv", ".json", ".jsonl")


def scan_data_files(patterns: list[str], project_path: str) -> list[str]:
    """展开数据文件路径（支持通配符、相对路径、data/ 目录扫描）。

    逻辑：
    1. 若 patterns 非空：逐个展开通配符 / 直连存在的路径，合并去重
    2. 若 patterns 为空（或展开后为空）：扫描项目 data/ 目录下的支持文件
    3. 最终按 SUPPORTED_EXTENSIONS 过滤

    Args:
        patterns: 用户输入的文件模式列表（可为相对项目根的路径或通配符）
        project_path: 项目根目录绝对路径

    Returns:
        绝对路径列表（已去重、已排序的 data/ 扫描部分 + 保持展开顺序的 patterns 部分）
    """
    file_paths: list[str] = []
    for pattern in patterns:
        if not os.path.isabs(pattern):
            pattern = os.path.join(project_path, pattern)
        matched = glob.glob(pattern)
        if matched:
            file_paths.extend(matched)
        elif os.path.exists(pattern):
            file_paths.append(pattern)

    # 无文件参数时扫描 data/ 目录（保持原 _scan_data_files 行为）
    if not file_paths:
        data_dir = Path(project_path) / "data"
        if data_dir.exists():
            for ext in SUPPORTED_EXTENSIONS:
                file_paths.extend(str(p) for p in data_dir.glob(f"*{ext}"))

    # 过滤支持的文件类型
    return [p for p in file_paths if p.lower().endswith(SUPPORTED_EXTENSIONS)]


def apply_generated_config(result: dict[str, Any], project_path: str) -> list[str]:
    """将生成的配置写入项目目录。

    会保留现有 project.precis.yaml 中的 transforms/manual_data 等引用，
    覆盖写入 schemas、constraints、regex_nodes。

    Args:
        result: ConfigGenerationService / ConfigMigrationService 返回的配置字典
        project_path: 项目根目录

    Returns:
        已写入的文件相对路径列表（manifest + 各 schema/constraint/regex 文件）
    """
    written: list[str] = []

    manifest_path = Path(project_path) / "project.precis.yaml"
    existing_manifest: dict[str, Any] = {}
    if manifest_path.exists():
        try:
            existing_manifest = read_yaml(manifest_path) or {}
        except Exception:
            logger.warning("读取现有 manifest 失败，将覆盖写入", exc_info=True)

    manifest = result.get("manifest") or {"version": 2, "project": {"id": "", "name": ""}}

    # 保留现有 manifest 中生成未覆盖的引用
    for key in ("transforms", "manual_data"):
        if key in existing_manifest and key not in manifest:
            manifest[key] = existing_manifest[key]

    schemas = result.get("schemas", {})
    constraints = result.get("constraints", {})
    regex_nodes = result.get("regex_nodes", {})

    # 确保目录存在
    (Path(project_path) / "schemas").mkdir(exist_ok=True)
    (Path(project_path) / "constraints").mkdir(exist_ok=True)
    (Path(project_path) / "regex").mkdir(exist_ok=True)

    # 更新 manifest 引用
    manifest["schemas"] = [{"id": sid, "path": f"schemas/{sid}.schema.yaml"} for sid in schemas]
    manifest["constraints"] = [{"id": cid, "path": f"constraints/{cid}.constraint.yaml"} for cid in constraints]
    manifest["regex_nodes"] = [{"id": rid, "path": f"regex/{rid}.regex.yaml"} for rid in regex_nodes]

    # 写入 manifest
    write_yaml(manifest_path, manifest)
    written.append("project.precis.yaml")

    # 写入资源文件
    for sid, schema in schemas.items():
        rel = f"schemas/{sid}.schema.yaml"
        write_yaml(Path(project_path) / rel, schema)
        written.append(rel)
    for cid, constraint in constraints.items():
        rel = f"constraints/{cid}.constraint.yaml"
        write_yaml(Path(project_path) / rel, constraint)
        written.append(rel)
    for rid, regex_node in regex_nodes.items():
        rel = f"regex/{rid}.regex.yaml"
        write_yaml(Path(project_path) / rel, regex_node)
        written.append(rel)

    return written


__all__ = [
    "SUPPORTED_EXTENSIONS",
    "apply_generated_config",
    "scan_data_files",
]
