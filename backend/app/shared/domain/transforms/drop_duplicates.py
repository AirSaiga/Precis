"""
@fileoverview DropDuplicates 转换运行器

功能概述:
- 对 DataFrame 进行去重
- 支持指定子集列（逗号分隔）或全列去重
- 支持保留策略：first（保留第一条）、last（保留最后一条）、false（全部删除）

参数:
    subset: 去重列名，支持逗号分隔字符串或列表，留空则基于全部列去重
    keep: 保留策略 ("first"|"last"|"false")

说明:
    - input_column 被忽略（操作整行而非单列）
    - output_columns 被忽略（不产生新列，保留所有原始列）
    - 输出 DataFrame 索引重置为连续 0-based
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from .base import TransformRunner


class DropDuplicatesRunner(TransformRunner):
    """@classdesc 去重转换运行器"""

    def execute(
        self,
        df: pd.DataFrame,
        input_column: str,
        params: dict[str, Any],
        output_columns: list[str],
    ) -> pd.DataFrame:
        """
        @methoddesc 执行 去重转换

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
        keep = params.get("keep", "first")
        subset_raw = params.get("subset", "")

        # 解析 subset：兼容逗号分隔字符串与列表两种格式
        # 前端 tags 产出的是数组，旧配置/手写 YAML 可能是逗号分隔字符串
        subset = None
        if subset_raw:
            if isinstance(subset_raw, list):
                parsed = [str(col).strip() for col in subset_raw if str(col).strip()]
            else:
                parsed = [col.strip() for col in str(subset_raw).split(",") if col.strip()]
            # 只保留实际存在于 DataFrame 中的列
            parsed = [col for col in parsed if col in df.columns]
            if parsed:
                subset = parsed

        # pandas 的 keep 参数：keep=False 表示全部删除
        keep_param: str | bool = keep
        if keep == "false":
            keep_param = False

        result = df.drop_duplicates(subset=subset, keep=keep_param).reset_index(drop=True)
        return result
