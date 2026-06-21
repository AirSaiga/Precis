"""
@fileoverview 派生列提取模块

功能概述:
- 在格式解析后、约束校验前提取派生列（Extracted 类型列）
- 通过正则表达式的命名捕获组从源列提取数据
- 支持向量化提取和类型转换（Integer、Float、Boolean、String）

架构设计:
- 两阶段处理：格式解析 → 提取派生列 → 约束校验
- 正则驱动：从 schema 中读取正则模式，使用 pandas str.extract 向量化提取
- 错误上报：提取失败作为验证错误返回，避免静默通过

输入示例:
    _extract_derived_columns(
        parsed_datasets={"users": df},
        schema=DataSetSchema(...),
        raw_datasets={"users": raw_df},
        all_errors=[]
    )

输出示例:
    parsed_datasets 被就地修改，新增提取列
    all_errors 可能追加提取失败错误
"""

import logging
from typing import cast

import pandas as pd

from app.shared.domain.dataset_schema import DataSetSchema

logger = logging.getLogger(__name__)


# Extracted 类型列需要的属性（使用 Protocol 避免直接依赖 domain 子类）
class _ExtractedTypeProtocol:
    """仅用于类型检查的 Extracted 数据类型协议。"""

    name: str
    source_column: str
    extract_key: str
    result_type: str | None


def _extract_derived_columns(
    parsed_datasets: dict[str, pd.DataFrame],
    schema: DataSetSchema,
    raw_datasets: dict[str, pd.DataFrame],
    all_errors: list[dict],
) -> None:
    """
    @methoddesc 提取派生列（Extracted 类型列）

    在格式解析后、执行约束校验前，从 Extracted 类型的列中通过正则提取派生列。
    Extracted 类型标识该列是从另一个列的正则匹配结果中提取的。

    参数:
        parsed_datasets: 解析后的 DataFrame 字典（会被就地修改）
        schema: 完整的数据集 Schema
        raw_datasets: 原始 DataFrame 字典（用于保留原始字符串格式）
        all_errors: 错误列表（提取失败时会追加错误）
    """
    import re

    for table_id, parsed_df in parsed_datasets.items():
        logger.debug(f"Processing extracted columns for table: {table_id}")
        if table_id not in schema.tables:
            continue

        table_schema = schema.tables[table_id]

        # 查找所有 Extracted 类型的列
        extracted_columns = []
        for col in table_schema.columns.values():
            data_type = col.data_type
            logger.debug(f"Column {col.name} has data_type: {data_type}")
            if getattr(data_type, "name", None) == "Extracted":
                extracted_type = cast(_ExtractedTypeProtocol, data_type)
                extracted_columns.append(
                    {
                        "column_name": col.name,
                        "source_column": extracted_type.source_column,
                        "extract_key": extracted_type.extract_key,
                        "result_type": getattr(extracted_type, "result_type", None),
                    }
                )

        if not extracted_columns:
            continue

        logger.debug(f"表 '{table_id}' 发现 {len(extracted_columns)} 个提取列")

        for ext_info in extracted_columns:
            col_name = ext_info["column_name"]
            source_column = ext_info["source_column"]
            if not isinstance(source_column, str):
                continue
            extract_key = ext_info["extract_key"]
            result_type = ext_info.get("result_type")

            if source_column not in parsed_df.columns:
                all_errors.append(
                    {
                        "stage": "format",
                        "table": table_id,
                        "column": col_name,
                        "check_type": "ExtractedColumnValidation",
                        "error_type": "ExtractedColumnValidationError",
                        "message": (
                            f"提取列 '{col_name}' 失败：源列 '{source_column}' 不存在于表 '{table_id}'。请检查 Schema 配置。"
                        ),
                    }
                )
                continue

            # 获取源列绑定的正则表达式模式
            source_col = table_schema.columns.get(source_column)
            if not source_col:
                all_errors.append(
                    {
                        "stage": "format",
                        "table": table_id,
                        "column": col_name,
                        "check_type": "ExtractedColumnValidation",
                        "error_type": "ExtractedColumnValidationError",
                        "message": (
                            f"提取列 '{col_name}' 失败：源列 '{source_column}' 未在 schema 中定义。请检查 Schema 配置。"
                        ),
                    }
                )
                continue

            regex_pattern = None
            regex_flags = "g"
            case_sensitive = True

            source_data_type = source_col.data_type
            if hasattr(source_data_type, "name") and source_data_type.name == "Expr":
                # 显式 Expr：有 pattern 属性
                if hasattr(source_data_type, "pattern"):
                    regex_pattern = source_data_type.pattern
                    if hasattr(source_data_type, "flags"):
                        regex_flags = source_data_type.flags
                    if hasattr(source_data_type, "case_sensitive"):
                        case_sensitive = source_data_type.case_sensitive
                # 隐式 Expr：无 pattern 属性，但有 registry
                elif hasattr(source_data_type, "registry") and source_data_type.registry:
                    registry = source_data_type.registry
                    # 遍历 registry 中的所有 pattern，查找包含 extract_key 的
                    if hasattr(registry, "_patterns"):
                        for pattern_obj in registry._patterns:
                            if hasattr(pattern_obj, "regex") and pattern_obj.regex:
                                regex_obj = pattern_obj.regex
                                group_index = regex_obj.groupindex
                                if extract_key in group_index:
                                    regex_pattern = regex_obj.pattern
                                    break

            if not regex_pattern:
                all_errors.append(
                    {
                        "stage": "format",
                        "table": table_id,
                        "column": col_name,
                        "check_type": "ExtractedColumnValidation",
                        "error_type": "ExtractedColumnValidationError",
                        "message": (
                            f"提取列 '{col_name}' 失败：源列 '{source_column}' 没有绑定正则表达式。请检查 Schema 配置。"
                        ),
                    }
                )
                continue

            # 编译正则表达式
            flags = 0
            if "i" in regex_flags.lower() or not case_sensitive:
                flags |= re.IGNORECASE
            if "m" in regex_flags.lower():
                flags |= re.MULTILINE
            if "s" in regex_flags.lower():
                flags |= re.DOTALL

            # 执行提取
            try:
                compiled = re.compile(regex_pattern, flags)
                group_names = list(compiled.groupindex.keys())

                # 获取源列的原始数据作为 Series（优先使用 raw_df 保留原始字符串格式）
                raw_df = raw_datasets.get(table_id)
                if raw_df is not None and source_column in raw_df.columns:
                    source_series = raw_df[source_column].fillna("").astype(str)
                else:
                    source_series = parsed_df[source_column].fillna("").astype(str)

                # 使用 pandas str.extract 进行向量化提取
                extracted_df = source_series.str.extract(compiled)
                match_count = extracted_df.notna().any(axis=1).sum()

                if extract_key in extracted_df.columns:
                    extracted_series = extracted_df[extract_key].replace("", pd.NA)

                    # 根据 result_type 进行向量化类型转换
                    if result_type == "Integer":
                        parsed_df[col_name] = pd.to_numeric(extracted_series, errors="coerce").astype("Int64")
                    elif result_type == "Float":
                        parsed_df[col_name] = pd.to_numeric(extracted_series, errors="coerce")
                    elif result_type == "Boolean":
                        is_null = extracted_series.isna() | (extracted_series.str.strip() == "")
                        bool_series = extracted_series.str.lower().isin(["true", "1", "yes"]).astype("boolean")
                        bool_series[is_null] = pd.NA
                        parsed_df[col_name] = bool_series
                    else:
                        # String 或其他类型保持原样
                        parsed_df[col_name] = extracted_series

                    logger.debug(
                        f"提取列 '{col_name}' <- '{source_column}'[{extract_key}], 匹配 {match_count} 行, 类型: {result_type or 'String'}"
                    )
                else:
                    error_msg = f"提取键 '{extract_key}' 不在正则表达式的命名捕获组中，可用组: {group_names}"
                    logger.warning(error_msg)
                    # 将配置错误上报为验证错误，避免用户看到"通过"（M4）
                    all_errors.append(
                        {
                            "stage": "format",
                            "table": table_id,
                            "column": col_name,
                            "check_type": "ExtractedColumnValidation",
                            "message": error_msg,
                        }
                    )

            except Exception as e:
                logger.warning(
                    f"正则提取列 '{col_name}' 失败 (来源列: '{source_column}', 提取键: '{extract_key}'): {e}",
                    exc_info=True,
                )

        # 更新 parsed_datasets 中的 DataFrame
        parsed_datasets[table_id] = parsed_df
