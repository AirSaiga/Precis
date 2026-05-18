"""@fileoverview 正则提取工具模块

功能概述:
- 从数据列值中按命名捕获组提取派生列数据
- 支持将提取结果应用到 pandas DataFrame
"""

import re

import pandas as pd


def extract_columns_from_values(
    regex_pattern: str, regex_flags: str, case_sensitive: bool, values: list[str], match_mode: str = "extract"
) -> tuple[dict[str, list[str]], list[str], int, int]:
    """
    @methoddesc 从值列表中提取命名捕获组数据。

    【功能说明】
    这是后端 /utils/regex/validate-extract 接口的核心逻辑封装，
    可以在数据校验流程中直接调用，无需通过 HTTP 请求。

    【参数说明】
    :param regex_pattern: 正则表达式模式字符串
    :param regex_flags: 正则标志字符串（如 "gi"）
    :param case_sensitive: 是否区分大小写
    :param values: 目标列的值列表
    :param match_mode: 匹配模式，"full" 或 "partial"（extract 本质也是 partial）

    【返回值】
    :return: (extracted_columns, group_names, match_count, error_count)
             - extracted_columns: 提取的列数据字典
             - group_names: 命名捕获组名称列表
             - match_count: 匹配成功数量
             - error_count: 匹配失败数量
    """
    flags = 0
    if "i" in regex_flags.lower():
        flags |= re.IGNORECASE
    if "m" in regex_flags.lower():
        flags |= re.MULTILINE
    if "s" in regex_flags.lower():
        flags |= re.DOTALL
    if not case_sensitive:
        flags |= re.IGNORECASE

    compiled = re.compile(regex_pattern, flags)
    group_names = list(compiled.groupindex.keys())
    extracted_columns: dict[str, list[str]] = {name: [] for name in group_names}

    match_count = 0
    error_count = 0

    for value in values:
        value_str = "" if value is None else str(value)
        if match_mode == "full":
            match = compiled.match(value_str)
        else:
            match = compiled.search(value_str)

        if match:
            match_count += 1
            groups = match.groupdict()
            for name in group_names:
                extracted_columns[name].append("" if groups.get(name) is None else str(groups.get(name)))
        else:
            error_count += 1
            for name in group_names:
                extracted_columns[name].append("")

    return extracted_columns, group_names, match_count, error_count


def apply_extracted_columns_to_dataframe(
    df: pd.DataFrame, extracted_columns: dict[str, list[str]], column_names: list[str]
) -> pd.DataFrame:
    """
    @methoddesc 将提取的列数据应用到 DataFrame。

    【功能说明】
    将 extracted_columns 中的数据作为新列添加到 DataFrame。

    【参数说明】
    :param df: 原始 DataFrame
    :param extracted_columns: 提取的列数据字典
    :param column_names: 新列的名称列表（与 extracted_columns 的 key 对应）

    【返回值】
    :return: 添加了新列的 DataFrame
    """
    result_df = df.copy()

    for col_name in column_names:
        if col_name in extracted_columns:
            result_df[col_name] = extracted_columns[col_name]

    return result_df
