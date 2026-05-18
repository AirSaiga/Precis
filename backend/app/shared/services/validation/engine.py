"""
@fileoverview 数据校验服务层

功能概述:
- 执行完整的数据验证流程，包括格式解析和约束校验
- 支持两阶段验证：格式解析验证 + 逻辑约束验证
- 为前端可视化校验和命令行校验提供统一的校验入口
- 聚合格式错误和约束错误后统一返回

架构设计:
- 阶段一（格式解析）：逐表解析原始数据，应用字段类型转换和格式验证
- 阶段二（逻辑约束）：对解析后的数据进行跨表约束校验（外键、唯一性、条件、脚本化约束）
- 错误聚合：将两阶段的错误合并后统一返回

输入示例:
    raw_datasets = {
        "users": pd.DataFrame({
            "id": ["1", "2", "3"],
            "age": ["25", "30", "abc"]
        })
    }
    schema = DataSetSchema(tables={...}, constraints=[...])
    parsed, errors, details = validate_full_dataset(raw_datasets, schema)

输出示例:
    parsed_datasets: 解析后的 DataFrame 字典
    all_errors: 格式错误 + 约束错误列表
    validation_details: 详细校验信息
"""

import logging
from typing import Optional, Union

import pandas as pd

from app.shared.core.project.regex.types import RegexNodeFile
from app.shared.core.project.transform.types import TransformFile
from app.shared.domain.data_engine import process_dataframe
from app.shared.domain.dataset_schema import DataSetSchema

logger = logging.getLogger(__name__)

from .dag import build_transform_dag, execute_transform_dag
from .extractors import _extract_derived_columns


def validate_full_dataset(
    raw_datasets: dict[str, pd.DataFrame],
    schema: DataSetSchema,
    allow_unsafe_eval: bool = False,
    table_filter: Optional[Union[str, list[str]]] = None,
    transform_files: Optional[dict[str, TransformFile]] = None,
    regex_files: Optional[dict[str, RegexNodeFile]] = None,
) -> tuple[dict[str, pd.DataFrame], list[dict], dict[str, list[dict]]]:
    """
    @methoddesc 执行完整的验证流程，包括格式解析和约束校验

    这是数据校验的主入口函数，执行两阶段验证：
    1. 阶段一：格式解析验证 - 对每个表的原始数据进行类型转换和格式检查
    2. 阶段二：逻辑约束验证 - 对解析后的数据进行业务规则校验

    参数:
        raw_datasets: 包含原始 DataFrame 的字典，键为表名，值为 pandas DataFrame
        schema: 完整的数据集 Schema 定义，包含表结构和约束配置
        allow_unsafe_eval: 是否允许执行不安全的脚本化约束。默认为 False（安全模式）
        table_filter: 只验证与这些表相关的约束

    返回:
        元组 (parsed_datasets, all_errors, validation_details)
        - parsed_datasets: 解析后的 DataFrame 字典
        - all_errors: 所有格式错误和逻辑错误的聚合列表
        - validation_details: 校验详情，包含 format_checks 和 constraint_checks

    使用示例:
        >>> from app.shared.domain.dataset_schema import DataSetSchema
        >>> raw_data = {'users': pd.DataFrame({'id': [1, 2], 'name': ['Alice', 'Bob']})}
        >>> schema = DataSetSchema(...)
        >>> parsed, errors, details = validate_full_dataset(raw_data, schema)
    """
    # 初始化错误列表和解析结果字典
    # all_errors: 用于存储两阶段产生的所有错误
    # parsed_datasets: 用于存储解析后的DataFrame，供阶段二使用
    all_errors = []
    parsed_datasets: dict[str, pd.DataFrame] = {}

    # 初始化校验详情
    # validation_details: 用于存储所有校验过程的详细信息
    validation_details: dict[str, list[dict]] = {
        "format_checks": [],  # 格式校验信息
        "constraint_checks": [],  # 约束校验信息
    }

    # ========================
    # 阶段一：格式解析验证
    # ========================
    # 逐表遍历原始数据，应用字段类型转换和格式验证
    # process_dataframe 会根据 table_schema 中的字段定义进行：
    # - 类型转换（字符串转日期、数字等）
    # - 格式验证（正则匹配、范围检查等）
    #
    # 【派生列处理说明】
    # 对于 regex 提取的派生列（ColumnSpec.derived_from 不为 None）：
    # - 当前版本：从原始数据文件加载时，这些列的数据不存在
    # - 未来版本：需要从缓存文件或通过重新执行 regex 提取来获取派生列数据
    # - 实现思路：
    #   1. 识别 schema 中的派生列（使用 is_derived_column 函数）
    #   2. 从缓存文件或内存中加载派生列数据
    #   3. 将派生列数据合并到 parsed_df 中
    logger.debug("开始阶段一: 格式解析验证")
    for table_id, raw_df in raw_datasets.items():
        # 跳过未在Schema中定义的表（允许数据集包含额外表）
        if table_id not in schema.tables:
            logger.warning(f"数据集中存在未在Schema中定义的表 '{table_id}', 将跳过。")
            continue

        # 获取表的Schema定义，进行格式解析
        table_schema = schema.tables[table_id]
        # process_dataframe 返回：(解析后的DataFrame, 错误DataFrame)
        parsed_df, parsing_errors = process_dataframe(raw_df, table_schema)

        # 存储解析后的数据，供阶段二约束校验使用（使用 table_id 作为键）
        parsed_datasets[table_id] = parsed_df
        # 将解析错误转换为字典列表并聚合到总错误列表
        if not parsing_errors.empty:
            for item in parsing_errors.to_dict("records"):
                all_errors.append(
                    {
                        **item,
                        "stage": "format",
                        "table": table_id,
                        "table_id": table_id,
                        "check_type": "FormatValidation",
                        "message": item.get("error_message"),
                    }
                )

        # 记录格式校验信息
        validation_details["format_checks"].append(
            {"table": table_id, "error_count": len(parsing_errors), "passed": len(parsing_errors) == 0}
        )

        logger.debug(f"表 '{table_id}' 解析完成。发现 {len(parsing_errors)} 个格式错误。")

    # ========================
    # 阶段一续：提取派生列
    # ========================
    logger.debug("开始阶段一续: 提取派生列")
    _extract_derived_columns(parsed_datasets, schema, raw_datasets, all_errors)

    # ========================
    # 阶段一续二：执行 Transform DAG
    # ========================
    if transform_files or regex_files:
        logger.debug("开始阶段一续二: 执行 Transform DAG")
        dag = build_transform_dag(
            transform_files or {},
            set(parsed_datasets.keys()),
            regex_files,
        )
        parsed_datasets = execute_transform_dag(dag, parsed_datasets)

    # ========================
    # 阶段二：逻辑约束验证
    # ========================
    # 对解析后的数据进行业务规则校验
    # 支持的约束类型：
    # - ForeignKeyConstraints: 外键约束
    # - UniqueConstraint: 唯一性约束
    # - AllowedValuesConstraint: 允许值约束
    # - ConditionalConstraint: 条件约束
    # - ScriptedConstraint: 脚本化约束
    logger.debug("开始阶段二: 逻辑约束验证")

    # 如果所有表都为空，跳过约束验证以避免无意义计算和边界错误（M3）
    has_any_data = any(not df.empty for df in parsed_datasets.values())
    if not has_any_data:
        logger.debug("所有解析后的表均为空，跳过阶段二约束验证")
        return parsed_datasets, all_errors, validation_details

    # 处理 table_filter 参数（只接受表ID）
    filter_tables: Optional[set] = None
    if table_filter:
        if isinstance(table_filter, str):
            filter_tables = {table_filter}
        else:
            filter_tables = set(table_filter)

    # 遍历所有注册的约束，逐个执行校验
    for i, constraint in enumerate(schema.constraints):
        # 获取约束信息，判断是否需要跳过
        try:
            constraint_info = constraint.get_constraint_info()
        except Exception as e:
            logger.error(f"约束 {i + 1} 获取信息失败: {e}")
            validation_details["constraint_checks"].append(
                {
                    "constraint_type": constraint.__class__.__name__,
                    "table": None,
                    "description": "",
                    "error_count": 1,
                    "passed": False,
                    "error": str(e),
                }
            )
            continue

        constraint_table = constraint_info.get("table")

        # 如果指定了 table_filter，只验证相关表的约束
        if filter_tables and constraint_table not in filter_tables:
            logger.debug(f"跳过约束 {i + 1} ({constraint.__class__.__name__}): 表 '{constraint_table}' 不在过滤列表中")
            continue

        # 传递 allow_unsafe_eval 参数以控制脚本约束的执行
        # 当 allow_unsafe_eval=False 时，脚本约束会在安全沙箱中运行
        # 单个约束异常不中断整个管线，继续执行后续约束
        try:
            result = constraint.validate(parsed_datasets, allow_unsafe_eval=allow_unsafe_eval)
        except Exception as e:
            logger.error(f"约束 {i + 1} ({constraint.__class__.__name__}) 执行异常: {e}")
            result = {
                "errors": [
                    {
                        "error_type": "ConstraintExecutionError",
                        "table": constraint_table,
                        "message": f"约束执行异常: {e}",
                    }
                ],
                "info": constraint_info,
            }

        # 获取约束错误和约束信息
        constraint_errors = result.get("errors", [])
        constraint_info = result.get("info", {})

        # 聚合错误
        if constraint_errors:
            for item in constraint_errors:
                all_errors.append(
                    {
                        **item,
                        "stage": item.get("stage") or "constraint",
                        "check_type": item.get("check_type")
                        or constraint_info.get("constraint_type", constraint.__class__.__name__),
                        "table": item.get("table") or constraint_info.get("table"),
                    }
                )

        # 记录约束校验信息
        validation_details["constraint_checks"].append(
            {
                "constraint_type": constraint_info.get("constraint_type", constraint.__class__.__name__),
                "table": constraint_info.get("table"),
                "description": constraint_info.get("description", ""),
                "error_count": len(constraint_errors),
                "passed": len(constraint_errors) == 0,
            }
        )

        logger.debug(
            f"约束 {i + 1} ({constraint.__class__.__name__}) 验证完成。发现 {len(constraint_errors)} 个逻辑错误。"
        )

    # 返回解析后的数据集、所有错误和校验详情
    # 前端可以根据 is_empty(all_errors) 判断验证是否通过
    # validation_details 用于展示所有校验过程的详细信息
    return parsed_datasets, all_errors, validation_details
