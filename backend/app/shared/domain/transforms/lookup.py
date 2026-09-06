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
@fileoverview Lookup 转换运行器

功能概述:
- 根据映射表精确替换列值
- 支持默认值回退

参数:
    mapping: 字典映射 {旧值: 新值}
    default: 未匹配时的默认值（默认 None）
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from .base import TransformRunner


class LookupRunner(TransformRunner):
    """@classdesc 字典映射转换运行器"""

    def execute(
        self,
        df: pd.DataFrame,
        input_column: str,
        params: dict[str, Any],
        output_columns: list[str],
    ) -> pd.DataFrame:
        """
        @methoddesc 执行 字典查找/映射转换

        业务用途:
        - TransformRunner 协议的标准入口，由 transform 节点调用
        - 读取 params 中的转换参数，对 input_column 应用转换，输出到 output_columns

        参数:
            df: 源 DataFrame
            input_column: 输入列名
            params: 转换参数字典
            output_columns: 目标输出列名列表

        返回:
            转换后的 DataFrame
        """
        mapping = params.get("mapping", {})
        default = params.get("default", None)

        if input_column not in df.columns:
            raise ValueError(f"输入列不存在: {input_column}")

        if not output_columns:
            raise ValueError("Lookup 需要至少一个 output_columns")

        output_col = output_columns[0]

        df[output_col] = df[input_column].map(mapping)
        if default is not None:
            df[output_col] = df[output_col].fillna(default)

        return df
