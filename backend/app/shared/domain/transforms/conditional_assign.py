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
@fileoverview ConditionalAssign 转换运行器

功能概述:
- 根据条件判断对列进行条件赋值
- 支持多条件组合（AND/OR 逻辑）
- 支持 eq/ne/gt/gte/lt/lte/contains/startswith/endswith/in/not_in/is_null/is_not_null 操作符

参数:
    conditions: 条件列表 [{column, op, value}]
    logic: 条件组合逻辑 ("and"|"or")
    then_value: 条件满足时的赋值
    else_value: 条件不满足时的赋值（可选，不提供则保留原值）
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from .base import TransformRunner, evaluate_condition


class ConditionalAssignRunner(TransformRunner):
    """@classdesc 条件赋值转换运行器"""

    def execute(
        self,
        df: pd.DataFrame,
        input_column: str,
        params: dict[str, Any],
        output_columns: list[str],
    ) -> pd.DataFrame:
        """
        @methoddesc 执行 条件赋值转换

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
        conditions = params.get("conditions", [])
        # logic 归一大小写不敏感（"OR"/"And" 均合法），未知值 fail-fast——不再静默按 AND 组合
        raw_logic = params.get("logic", "and")
        logic = str(raw_logic).lower()
        if logic not in ("and", "or"):
            raise ValueError(f"未知的 logic '{raw_logic}'，支持的值为: and, or")
        # §1.18: then_value 缺省报配置错误——原实现缺省 "" 把命中行静默写空串。
        # 显式空串 then_value: '' 是合法赋值（写空串），只拒绝 None。
        if not output_columns:
            raise ValueError("ConditionalAssign 需要至少一个 output_columns")
        then_value = params.get("then_value")
        if then_value is None:
            raise ValueError("ConditionalAssign 缺少必填参数 then_value")

        output_col = output_columns[0]

        if not conditions:
            # 无条件时直接赋 then_value
            df[output_col] = then_value
            return df

        # 逐行评估所有条件，生成布尔掩码
        masks = []
        for cond in conditions:
            mask = evaluate_condition(df, cond)
            masks.append(mask)

        # 组合条件
        if logic == "or":
            combined = masks[0]
            for m in masks[1:]:
                combined = combined | m
        else:
            combined = masks[0]
            for m in masks[1:]:
                combined = combined & m

        # 赋值：输出列初始化为 object 类型以支持混合类型赋值（如 int 列赋 str 值）
        if input_column in df.columns:
            df[output_col] = df[input_column].copy().astype(object)
        else:
            df[output_col] = None
        df.loc[combined, output_col] = then_value
        # §1.18: 用键存在性区分"显式 null（置空）"与"未提供（保留原值）"——
        # params.get 对两者都返回 None，原实现 else 分支永不执行，想置空做不到
        if "else_value" in params:
            df.loc[~combined, output_col] = params["else_value"]

        return df
