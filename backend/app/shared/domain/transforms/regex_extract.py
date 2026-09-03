"""
@fileoverview RegexExtract 转换运行器

功能概述:
- 使用正则表达式从字符串中提取捕获组
- 输出多个新列（每个捕获组一列）

参数:
    pattern: 正则表达式模式（必须包含捕获组）
    flags: 正则标志（如 "i" 表示忽略大小写）
"""

from __future__ import annotations

import re
from typing import Any

import pandas as pd

from .base import TransformRunner, stringify_preserve_null


class RegexExtractRunner(TransformRunner):
    """@classdesc 正则提取转换运行器"""

    def execute(
        self,
        df: pd.DataFrame,
        input_column: str,
        params: dict[str, Any],
        output_columns: list[str],
    ) -> pd.DataFrame:
        """
        @methoddesc 执行 正则提取转换

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
        pattern = params.get("pattern", "")
        flags_str = params.get("flags", "")

        if not pattern:
            raise ValueError("RegexExtract 需要 pattern 参数")

        if input_column not in df.columns:
            raise ValueError(f"输入列不存在: {input_column}")

        # flags 整词匹配（与 regex 约束/reader 同一套 token 语义），不得子串包含
        _flag_short_map = {"i": re.IGNORECASE, "m": re.MULTILINE, "s": re.DOTALL}
        flag_values = 0
        for tok in [t for t in re.split(r"[,\s]+", str(flags_str).strip()) if t]:
            if all(ch in _flag_short_map for ch in tok.lower()):
                for ch in tok.lower():
                    flag_values |= _flag_short_map[ch]

        compiled = re.compile(pattern, flag_values)

        def _extract(text: str | None) -> list[str | None]:
            if text is None:
                # 空值不参与提取（原 astype(str) 把空值字符串化为 "nan" 参与匹配）
                return [None] * len(output_columns)
            m = compiled.search(text)
            if not m:
                return [None] * len(output_columns)
            groups = m.groups()
            result: list[str | None] = []
            for i in range(len(output_columns)):
                if i < len(groups):
                    result.append(groups[i])
                else:
                    result.append(None)
            return result

        extracted = stringify_preserve_null(df[input_column]).apply(_extract)
        for i, col_name in enumerate(output_columns):
            df[col_name] = extracted.apply(lambda x: x[i] if x else None)

        return df
