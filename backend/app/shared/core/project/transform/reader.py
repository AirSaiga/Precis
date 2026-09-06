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
"""
@fileoverview Transform 配置文件读取模块

功能概述:
- 读取并解析 .transform.yaml 配置文件
- 使用 Pydantic 模型进行数据验证

输入示例:
    transform_path = Path("/path/to/project/transforms/split.yaml")

    # 文件内容:
    # version: 2
    # id: split_name
    # type: StringSplit
    # enabled: true
    # input_column: full_name
    # params:
    #   delimiter: " "
    # output_columns: [first_name, last_name]

输出示例:
    TransformFile(
        version=2,
        id="split_name",
        type="StringSplit",
        enabled=True,
        input_column="full_name",
        params={"delimiter": " "},
        output_columns=["first_name", "last_name"]
    )
"""

from __future__ import annotations

from pathlib import Path

import yaml

from .types import TransformFile


def load_transform(transform_path: Path) -> TransformFile:
    """@methoddesc 加载 Transform 配置文件

    输入示例:
        transform_path = Path("/path/to/project/transforms/split.yaml")

    输出示例:
        TransformFile(
            version=2,
            id="split_name",
            type="StringSplit",
            enabled=True,
            input_column="full_name",
            params={"delimiter": " "},
            output_columns=["first_name", "last_name"]
        )
    """
    with open(transform_path, encoding="utf-8") as f:
        raw = yaml.safe_load(f) or {}
    return TransformFile.model_validate(raw)
