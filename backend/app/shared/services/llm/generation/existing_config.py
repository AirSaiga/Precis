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
"""@fileoverview 既有项目配置加载（keep_existing 合并基线）

读取项目清单文件以及其引用的 schema、constraint、regex 文件，组装成
供 build_config 合并使用的既有配置字典。读取失败仅记警告、按条跳过，
保证生成流程对局部损坏的项目配置保持宽容。
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

from app.shared.core.io.yaml import read_yaml

logger = logging.getLogger(__name__)


def load_existing_config(config_path: str) -> dict[str, Any] | None:
    """加载现有配置（用于 keep_existing 合并）。

    读取项目清单文件以及引用的 schema、constraint、regex 文件。

    参数:
        config_path: 项目配置目录（含 project.precis.yaml）

    返回:
        {"manifest": ..., "schemas": {...}, "constraints": {...}, "regex_nodes": {...}}；
        清单不存在或整体读取失败时返回 None
    """
    manifest_path = os.path.join(config_path, "project.precis.yaml")
    if not os.path.isfile(manifest_path):
        return None

    try:
        manifest_data = read_yaml(Path(manifest_path))
        if not isinstance(manifest_data, dict):
            return None

        existing: dict[str, Any] = {
            "manifest": manifest_data,
            "schemas": {},
            "constraints": {},
            "regex_nodes": {},
        }

        # 读取现有 schema 文件
        for ref in manifest_data.get("schemas", []):
            schema_path = os.path.join(config_path, ref.get("path", ""))
            if os.path.isfile(schema_path):
                try:
                    raw = read_yaml(Path(schema_path))
                    if isinstance(raw, dict):
                        existing["schemas"][ref["id"]] = raw
                except Exception as e:
                    logger.warning(f"读取现有 schema 文件失败 {schema_path}: {e}")

        # 读取现有 constraint 文件
        for ref in manifest_data.get("constraints", []):
            constraint_path = os.path.join(config_path, ref.get("path", ""))
            if os.path.isfile(constraint_path):
                try:
                    raw = read_yaml(Path(constraint_path))
                    if isinstance(raw, dict):
                        existing["constraints"][ref["id"]] = raw
                except Exception as e:
                    logger.warning(f"读取现有 constraint 文件失败 {constraint_path}: {e}")

        # 读取现有 regex 文件
        for ref in manifest_data.get("regex_nodes", []):
            regex_path = os.path.join(config_path, ref.get("path", ""))
            if os.path.isfile(regex_path):
                try:
                    raw = read_yaml(Path(regex_path))
                    if isinstance(raw, dict):
                        existing["regex_nodes"][ref["id"]] = raw
                except Exception as e:
                    logger.warning(f"读取现有 regex 文件失败 {regex_path}: {e}")

        return existing
    except Exception as e:
        logger.warning(f"加载现有配置失败: {e}")
        return None
