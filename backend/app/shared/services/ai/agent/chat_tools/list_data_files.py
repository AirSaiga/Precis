# SPDX-License-Identifier: Apache-2.0
#
# Copyright 2026 Precis Team
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
"""@fileoverview list_data_files 工具

Chat mini-agent 可调用的工具：扫描项目目录，发现磁盘上的数据文件。

解决"空项目 + 目录下有裸数据文件"的发现缺口：read_project 只读 manifest
已注册的配置，read_table 只能读已注册 schema 的表——用户说"根据目录下的
文件初始化校验配置"时，agent 此前没有任何工具能看到未注册的数据文件，
只能反过来追问用户文件路径。本工具补上"查"闭环的第一环（发现 → 采样 →
建配置）。

扫描规则：
- 扩展名白名单与数据加载器支持面一致：csv/tsv/xlsx/xls/json/jsonl/ndjson
- 排除配置/脚手架目录（schemas、constraints、regex_nodes、transforms、
  templates、patterns、.precis）与常见噪音目录（.git、node_modules 等）；
  data/ 是标准数据目录，正常扫描
- 递归深度与总量上限防爆（超大目录只报前 N 个 + truncated 计数）
- 每个文件标注注册状态（是否被某 schema 的 source.path 引用），未注册的
  排前面——那是"待初始化"的候选，agent 最关心的信息
"""

from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path
from typing import Any

import yaml

logger = logging.getLogger(__name__)

# 数据文件扩展名白名单（与 infer_schema/read_table 的支持面一致）
_DATA_EXTENSIONS = {".csv", ".tsv", ".xlsx", ".xls", ".json", ".jsonl", ".ndjson"}

# 整棵跳过的目录：配置脚手架（create.py _REQUIRED_SUBDIRS 中的非数据目录）+ 常见噪音
_EXCLUDED_DIRS = {
    "schemas",
    "constraints",
    "regex_nodes",
    "transforms",
    "templates",
    "patterns",
    ".precis",
    ".git",
    "node_modules",
    "__pycache__",
    "dist",
    "build",
    ".venv",
    "venv",
}

# 递归深度上限（项目根为第 1 层）；数据文件通常在根或 data/ 下，2-3 层足够
_MAX_DEPTH = 3
# 返回文件数上限：超出部分只报计数，避免 observation 过大被 memory 硬切
_MAX_FILES = 200


class ListDataFilesTool:
    """
    @classdesc 数据文件发现工具

    扫描项目目录（含 data/ 子目录），列出全部数据文件并标注注册状态。
    不接收任何参数——扫描的就是 runner 绑定的当前项目。
    """

    NAME = "list_data_files"

    def __init__(self, project_path: str):
        """
        @methoddesc 初始化工具

        参数:
            project_path: 当前项目配置目录路径
        """
        self.project_path = project_path

    def get_definition(self) -> dict[str, Any]:
        """返回 OpenAI tool 定义。"""
        return {
            "type": "function",
            "function": {
                "name": self.NAME,
                "description": (
                    "扫描项目目录，列出磁盘上所有数据文件（CSV/Excel/JSON 等），"
                    "并标注每个文件是否已被 schema 注册（source.path 引用）。"
                    "当用户说'根据目录下的文件/表初始化项目/校验配置'、或项目里还没有"
                    "schema 但用户提到数据文件时，先调用此工具发现文件，"
                    "再决定为哪些文件创建 schema。无需参数。"
                ),
                "parameters": {
                    "type": "object",
                    "properties": {},
                    "required": [],
                },
            },
        }

    async def run(self, arguments: dict[str, Any]) -> dict[str, Any]:
        """
        @methoddesc 执行数据文件扫描

        参数:
            arguments: tool 参数（本工具无参数）

        返回:
            {"success": bool, "data_files": [...], "total_count": int,
             "unregistered_count": int, "truncated_count": int, "error": str}
            data_files 每项含 path（posix 相对路径）/name/extension/size_bytes/
            registered/registered_by（注册它的表名或表 id）
        """
        # arguments 无参数，但保留接口一致性
        _ = arguments

        if not self.project_path:
            return {"success": False, "error": "未配置项目路径", "data_files": []}

        try:
            # 目录扫描是同步 IO，放到线程池避免阻塞事件循环
            return await asyncio.to_thread(self._scan_data_files)
        except Exception as e:
            logger.exception("list_data_files 工具执行失败")
            return {"success": False, "error": f"扫描数据文件失败: {e}", "data_files": []}

    def _registered_file_map(self) -> dict[str, str]:
        """读 schemas/*.yaml 构建 {source.path(posix 相对) -> 表名/id} 映射。

        只取 name/id/source 三个字段，解析失败的文件跳过（发现工具不做校验，
        坏文件交给 read_project/load 链路报告）。
        """
        mapping: dict[str, str] = {}
        schemas_dir = Path(self.project_path) / "schemas"
        if not schemas_dir.is_dir():
            return mapping
        for schema_file in schemas_dir.glob("*.yaml"):
            try:
                with open(schema_file, encoding="utf-8") as f:
                    data = yaml.safe_load(f) or {}
                if not isinstance(data, dict):
                    continue
                source = data.get("source") or {}
                rel = source.get("path") if isinstance(source, dict) else None
                if isinstance(rel, str) and rel:
                    label = str(data.get("name") or data.get("id") or "")
                    if label:
                        mapping[rel.replace("\\", "/")] = label
            except Exception as e:
                logger.debug(f"解析 schema 文件失败 {schema_file}: {e}")
        return mapping

    def _scan_data_files(self) -> dict[str, Any]:
        """
        @methoddesc 同步扫描项目目录（在线程池中执行）

        返回:
            结果字典（结构见 run 文档）
        """
        root = Path(self.project_path)
        registered_map = self._registered_file_map()

        collected: list[dict[str, Any]] = []
        truncated_count = 0
        for dirpath, dirnames, filenames in os.walk(root):
            rel_dir = os.path.relpath(dirpath, root)
            depth = 1 if rel_dir == "." else rel_dir.count(os.sep) + 2
            if depth > _MAX_DEPTH:
                # 超深的整棵剪枝（os.walk 原地改 dirnames 即跳过子树）
                dirnames[:] = []
                continue
            dirnames[:] = [d for d in dirnames if d not in _EXCLUDED_DIRS]
            for fname in sorted(filenames):
                ext = os.path.splitext(fname)[1].lower()
                if ext not in _DATA_EXTENSIONS:
                    continue
                if len(collected) >= _MAX_FILES:
                    truncated_count += 1
                    continue
                rel_posix = os.path.join(rel_dir, fname).replace(os.sep, "/") if rel_dir != "." else fname
                abs_path = os.path.join(dirpath, fname)
                try:
                    size = os.path.getsize(abs_path)
                except OSError:
                    size = 0
                registered_by = registered_map.get(rel_posix) or registered_map.get(rel_posix.lower())
                collected.append(
                    {
                        "path": rel_posix,
                        "name": os.path.splitext(fname)[0],
                        "extension": ext,
                        "size_bytes": size,
                        "registered": registered_by is not None,
                        "registered_by": registered_by,
                    }
                )

        # 未注册的排前面：那是"待初始化"候选，agent 最关心的信息
        collected.sort(key=lambda f: (f["registered"], f["path"]))

        unregistered = [f for f in collected if not f["registered"]]
        return {
            "success": True,
            "data_files": collected,
            "total_count": len(collected),
            "unregistered_count": len(unregistered),
            "truncated_count": truncated_count,
        }
