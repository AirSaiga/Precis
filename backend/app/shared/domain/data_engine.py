"""
@fileoverview 数据处理引擎模块

功能概述:
- 提供 DataFrame 解析和验证的核心逻辑
- 执行逐单元格的类型检查和格式验证
- 支持结构化列展开（JSON 展开）
- 收集并报告验证错误

架构设计:
- process_dataframe 是核心函数，逐行逐列验证数据
- 使用 DataType 的 validate 方法进行类型验证
- 使用 DataType 的 parse 方法进行类型转换
- 支持结构化列展开（ExpressionType 类型）

输入示例:
    from app.shared.domain.dataset_schema import TableSchema
    from app.shared.domain.data_engine import process_dataframe

    schema = TableSchema(name="users", columns=[...])
    parsed_df, errors_df = process_dataframe(raw_df, schema)

输出示例:
    parsed_df: 解析后的 DataFrame（类型已转换）
    errors_df: 错误列表，每项包含 row_index、column、message
"""

# 1. 第三方库导入
import pandas as pd

# 2. 项目内部导入
from app.shared.domain.data_types import ExpressionType
from app.shared.domain.dataset_schema import TableSchema


def _expand_structured_columns(df: pd.DataFrame, table_schema: TableSchema) -> pd.DataFrame:
    """
    展开结构化列（JSON 列）。

    ============================================================================
    业务场景 (什么情况下会调用这个函数)
    ============================================================================
    - 场景1: 展开 JSON 列
      当列的数据类型是 ExpressionType 且 expand=True 时，
      将 JSON 对象展开为多个独立的列。

    ============================================================================
    数据流 (输入如何变成输出)
    ============================================================================
    输入参数:
      - df: pd.DataFrame 待处理的 DataFrame
      - table_schema: TableSchema 表结构定义

    处理步骤:
      1. 遍历所有列
      2. 检查是否有 ExpressionType 且 expand=True 的列
      3. 使用 pd.json_normalize 展开 JSON
      4. 合并到原 DataFrame

    最终输出: pd.DataFrame - 展开后的 DataFrame
    """
    # 复制 DataFrame 避免修改原始数据，保证函数的纯性
    df_to_process = df.copy()

    # 遍历 schema 中定义的所有列，查找需要展开的结构化列
    for col_name, col_schema in table_schema.columns.items():
        # 条件判断：列必须存在于 DataFrame 中，且 schema 标记为需要展开
        if col_name in df_to_process.columns and col_schema.expand:
            # 仅 ExpressionType 类型的列支持展开，其他类型跳过
            if not isinstance(col_schema.data_type, ExpressionType):
                continue

            # 步骤 1：将 JSON 列的每一行解析为字典列表
            # fillna({}) 将 NaN 替换为空字典，避免 json_normalize 报错
            # tolist() 将 Series 转为 Python 列表，供 json_normalize 处理
            normalized_data = pd.json_normalize(df_to_process[col_name].fillna({}).tolist()).add_prefix(f"{col_name}_")

            # 步骤 2：删除原始的 JSON 列，避免列名冲突
            df_to_process = df_to_process.drop(columns=[col_name])

            # 步骤 3：将展开后的新列横向合并到原 DataFrame
            # axis=1 表示按列方向拼接（横向扩展）
            df_to_process = pd.concat([df_to_process, normalized_data], axis=1)

            # 记录展开操作日志，便于用户追溯数据结构变化
            import logging

            logger = logging.getLogger(__name__)
            logger.info(f"列 '{col_name}' 已被自动展开为新的列。")

    return df_to_process


def process_dataframe(df: pd.DataFrame, schema: TableSchema) -> tuple[pd.DataFrame, pd.DataFrame]:
    """
    处理 DataFrame，执行类型验证和解析。

    ============================================================================
    业务场景 (什么情况下会调用这个函数)
    ============================================================================
    - 场景1: 数据校验
      对导入的 Excel/CSV 数据进行类型验证，确保数据符合 schema 定义。

    - 场景2: 数据清洗
      将字符串类型的数据解析为正确的类型（如 "123" -> 123）。

    ============================================================================
    数据流 (输入如何变成输出)
    ============================================================================
    输入参数:
      - df: pd.DataFrame 原始 DataFrame
        示例值: pd.DataFrame({"user_id": ["1", "2"], "name": ["Alice", "Bob"]})
      - schema: TableSchema 表结构定义
        示例值: TableSchema(name="users", columns=[ColumnSchema(...), ...])

    处理步骤:
      ┌─────────────────────────────────────────────────────────────┐
      │ Step 1: 遍历每一列                                      │
      ├─────────────────────────────────────────────────────────────┤
      │ 输入: df, schema                                        │
      │ 操作: for col_name, col_schema in schema.columns.items()│
      │ 输出: 遍历每个定义的列                                  │
      └─────────────────────────────────────────────────────────────┘

      ┌─────────────────────────────────────────────────────────────┐
      │ Step 2: 检查列是否存在                                  │
      ├─────────────────────────────────────────────────────────────┤
      │ 输入: 列名                                               │
      │ 操作: if col_name not in df.columns                     │
      │ 输出: 错误记录（MissingColumn）                         │
      └─────────────────────────────────────────────────────────────┘

      ┌─────────────────────────────────────────────────────────────┐
      │ Step 3: 遍历每一行的值                                  │
      ├─────────────────────────────────────────────────────────────┤
      │ 输入: 列的所有值                                         │
      │ 操作: for index, value in df[col_name].items()          │
      │ 输出: 逐个验证                                          │
      └─────────────────────────────────────────────────────────────┘

      ┌─────────────────────────────────────────────────────────────┐
      │ Step 4: 类型验证                                        │
      ├─────────────────────────────────────────────────────────────┤
      │ 输入: cell value                                         │
      │ 操作: col_schema.data_type.validate(value)              │
      │ 输出: (is_valid, error_message)                        │
      └─────────────────────────────────────────────────────────────┘

      ┌─────────────────────────────────────────────────────────────┐
      │ Step 5: 类型解析                                        │
      ├─────────────────────────────────────────────────────────────┤
      │ 输入: 验证通过的值                                      │
      │ 操作: col_schema.data_type.parse(value)                 │
      │ 输出: 解析后的值                                        │
      └─────────────────────────────────────────────────────────────┘

      ┌─────────────────────────────────────────────────────────────┐
      │ Step 6: 展开结构化列                                    │
      ├─────────────────────────────────────────────────────────────┤
      │ 输入: 解析后的 DataFrame                                │
      │ 操作: _expand_structured_columns                         │
      │ 输出: 展开后的 DataFrame                                │
      └─────────────────────────────────────────────────────────────┘

    最终输出: Tuple[pd.DataFrame, pd.DataFrame]
      - 第一个元素: 解析后的 DataFrame
      - 第二个元素: 错误 DataFrame

    ============================================================================
    错误格式
    ============================================================================
    错误 DataFrame 包含以下列：
    - row_index: 行索引（整数）
    - column: 列名（字符串）
    - value: 错误值（任意类型）
    - error_type: 错误类型（字符串）
    - error_message: 错误消息（字符串）

    ============================================================================
    边界情况处理
    ============================================================================
    - 缺少列: 记录 MissingColumn 错误，该列填充 None
    - 空 DataFrame: 返回空的解析 DataFrame 和空的错误 DataFrame
    - 验证失败: 记录错误，该单元格填充 None
    """
    # 存储解析后的列数据，键为列名，值为解析后的列表
    parsed_data: dict[str, list] = {}

    # 存储所有验证和解析过程中发现的错误
    errors: list[dict] = []

    # 记录原始 DataFrame 的行数，用于缺失列时填充空值
    num_rows = len(df)

    # 按 schema 定义的顺序逐列处理
    for col_name, col_schema in schema.columns.items():
        # 跳过派生列（Extracted 类型），它们不存在于原始数据中，由后续提取逻辑生成
        if hasattr(col_schema.data_type, "name") and col_schema.data_type.name == "Extracted":
            continue

        # 情况 1：schema 中定义的列在原始数据中不存在
        if col_name not in df.columns:
            # 记录 MissingColumn 错误，row_index 为 None 表示整列缺失
            errors.append(
                {
                    "row_index": None,
                    "column": col_name,
                    "value": None,
                    "error_type": "MissingColumn",
                    "error_message": f"数据表中缺少必需的列 '{col_name}'",
                }
            )
            # 用 None 填充整列，保持解析后 DataFrame 的列数与 schema 一致
            parsed_data[col_name] = [None] * num_rows
            continue

        # 从列 schema 中读取 nullable 属性，默认为 True（向后兼容）
        nullable = getattr(col_schema, "nullable", True)

        # 使用 DataType 的 process_column 进行向量化验证和解析
        # 向量化处理比逐行循环性能更高，且统一收集该列的全部错误
        parsed_series, col_errors = col_schema.data_type.process_column(df[col_name], col_name, nullable=nullable)
        parsed_data[col_name] = parsed_series
        errors.extend(col_errors)

    # 将解析后的列数据组装为 DataFrame，保留原始索引以维持行号对应关系
    parsed_df = pd.DataFrame(parsed_data, index=df.index)

    # 展开需要展开的结构化列（JSON 列）
    parsed_df = _expand_structured_columns(parsed_df, schema)

    # 构建错误 DataFrame：有错误时按标准列名构造，无错误时返回空结构（保持列名一致）
    if errors:
        errors_df = pd.DataFrame(errors, columns=["row_index", "column", "value", "error_type", "error_message"])
    else:
        errors_df = pd.DataFrame(columns=["row_index", "column", "value", "error_type", "error_message"])

    return parsed_df, errors_df
