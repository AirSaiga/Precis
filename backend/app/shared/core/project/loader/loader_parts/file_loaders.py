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
@fileoverview 配置文件加载器适配模块

功能概述:
- 为项目加载器提供 ManualData 文件的加载接口
- 其余配置文件（Schema/Constraint/Regex/Transform/Template）由各子模块的 reader 直接加载

架构设计:
- load_manual_data_file: 加载 ManualData 配置文件（YAML 读取 + 模型校验）
- 其他类型由调用方直接 import 对应 reader 模块的 load_xxx 函数

异常处理:
    - FileNotFoundError: 文件不存在
    - yaml.YAMLError: YAML 格式错误
    - ValidationError: 数据验证失败
"""

from __future__ import annotations

from pathlib import Path

from app.shared.core.project.manual_data.types import ManualDataFile


def load_manual_data_file(manual_data_path: Path) -> ManualDataFile:
    """@methoddesc 加载 ManualData 配置文件

    输入示例:
        manual_data_path = Path("/path/to/project/manual_data/ti1__md1.yaml")

    输出示例:
        ManualDataFile(
            id="ti1__md1",
            column_name="age",
            column_data_type="integer",
            rows=[["18"], ["25"], ["65"]],
        )
    """
    import yaml

    with open(manual_data_path, encoding="utf-8") as f:
        raw = yaml.safe_load(f) or {}
    return ManualDataFile.model_validate(raw)
