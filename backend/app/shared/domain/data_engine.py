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
    parsed_df, errors = process_dataframe(raw_df, schema)

输出示例:
    parsed_df: 解析后的 DataFrame（类型已转换）
    errors_df: 错误列表，每项包含 row_index、column、message
"""

# 1. 第三方库导入
import pandas as pd

# 2. 项目内部导入
from app.shared.domain.data_types import ExpressionType
from app.shared.domain.data_types_parts.json_types import JsonObjectType
from app.shared.domain.dataset_schema import ColumnSchema, TableSchema


def _reconstruct_expand_columns(df: pd.DataFrame, table_schema: TableSchema) -> pd.DataFrame:
    """
    将 pd.json_normalize 展平产生的点分列名重构回原始 dict 列。

    pd.json_normalize 会将 {"specs": {"brand": "X", "model": "Y"}} 展平为
    specs.brand 和 specs.model 两列。本函数对 schema 中 expand=True 且有 children
    的列，将这些点分列重新聚合为 dict 列（如 specs 列的每个单元格是一个 dict）。

    这样后续 _expand_structured_columns 就能正确处理这些列。
    """
    df = df.copy()
    for col_name, col_schema in table_schema.columns.items():
        if not col_schema.expand or not col_schema.children:
            continue
        if col_name in df.columns:
            continue

        prefix = f"{col_name}."
        matching_cols = [c for c in df.columns if c.startswith(prefix)]
        if not matching_cols:
            continue

        reconstructed = []
        for _, row in df.iterrows():
            cell = {}
            for child in col_schema.children or []:
                col_key = f"{col_name}.{child.name}"
                if col_key in df.columns:
                    val = row.get(col_key)
                    if pd.notna(val):
                        cell[child.name] = val
            reconstructed.append(cell if cell else None)

        df[col_name] = reconstructed
        df = df.drop(columns=matching_cols)

    return df


def _map_json_path_columns(df: pd.DataFrame, table_schema: TableSchema) -> pd.DataFrame:
    """
    使用 json_path 将 DataFrame 中的点分列名映射为 schema 定义的列名。

    pd.json_normalize 会将 {"location": {"zone": "A"}} 展平为 location.zone 列，
    但 schema 定义的列名可能是 location_zone，通过 json_path("$.location.zone") 关联。
    本函数根据 json_path 将 DataFrame 列名重命名为 schema 列名。
    """
    rename_map = {}
    for col_name, col_schema in table_schema.columns.items():
        if col_name in df.columns:
            continue
        if not col_schema.json_path:
            continue
        json_path = col_schema.json_path
        if not json_path.startswith("$."):
            continue
        dot_path = json_path[2:]
        if dot_path in df.columns:
            rename_map[dot_path] = col_name

    if rename_map:
        df = df.rename(columns=rename_map)

    return df


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
        if col_name not in df_to_process.columns or not col_schema.expand:
            continue

        # 仅 ExpressionType 和 JsonObjectType（有 children）支持展开
        is_expression = isinstance(col_schema.data_type, ExpressionType)
        is_json_object_with_children = isinstance(col_schema.data_type, JsonObjectType) and col_schema.children
        if not (is_expression or is_json_object_with_children):
            continue

        if is_json_object_with_children:
            if not col_schema.children:
                continue
            child_names = [child.name for child in col_schema.children]
            normalized_data = pd.json_normalize(df_to_process[col_name].fillna({}).tolist())
            normalized_data = normalized_data.reindex(columns=child_names)
            normalized_data = normalized_data.add_prefix(f"{col_name}_")
        else:
            normalized_data = pd.json_normalize(df_to_process[col_name].fillna({}).tolist()).add_prefix(f"{col_name}_")

        # 删除原始的 JSON 列，避免列名冲突
        df_to_process = df_to_process.drop(columns=[col_name])

        # 将展开后的新列横向合并到原 DataFrame
        df_to_process = pd.concat([df_to_process, normalized_data], axis=1)

        import logging

        logger = logging.getLogger(__name__)
        logger.info(f"列 '{col_name}' 已被自动展开为新的列。")

    return df_to_process


def _process_columns_recursive(
    df: pd.DataFrame,
    schema_columns: dict[str, ColumnSchema],
    parent_path: str,
    parsed_data: dict[str, list],
    errors: list[dict],
    num_rows: int,
) -> None:
    """递归处理 schema 列。

    JsonObject 列(有 children)跳过自身列检查,递归处理叶子子列。
    叶子列以「父.子」全限定名参与校验(对应 json_normalize 点分列)。
    平面列(无父)全限定名即自身名,行为不变。

    :param df: 待处理的 DataFrame
    :param schema_columns: 当前层级的列字典 {name: ColumnSchema}
    :param parent_path: 父级全限定路径(空串表示顶层)
    :param parsed_data: 累积解析列数据的字典
    :param errors: 累积错误的列表
    :param num_rows: 原始行数(用于缺失列填充)
    """
    prefix = f"{parent_path}." if parent_path else ""
    for col_name, col_schema in schema_columns.items():
        # 跳过派生列(Extracted 类型),它们不存在于原始数据中
        if hasattr(col_schema.data_type, "name") and col_schema.data_type.name == "Extracted":
            continue

        qualified = f"{prefix}{col_name}"

        # JsonObject 列(有 children):递归处理子列,跳过自身列检查
        # children 是 list[ColumnSchema],转为 {name: col} dict 以复用递归
        if isinstance(col_schema.data_type, JsonObjectType) and col_schema.children:
            child_dict = {c.name: c for c in col_schema.children}
            _process_columns_recursive(df, child_dict, qualified, parsed_data, errors, num_rows)
            continue

        # 叶子列(含平面列和嵌套叶子):按全限定名检查存在性
        if qualified not in df.columns:
            errors.append(
                {
                    "row_index": None,
                    "column": qualified,
                    "value": None,
                    "error_type": "MissingColumn",
                    "error_message": f"数据表中缺少必需的列 '{qualified}'",
                }
            )
            parsed_data[qualified] = [None] * num_rows
            continue

        # 类型校验(用全限定名取列)
        nullable = getattr(col_schema, "nullable", True)
        parsed_series, col_errors = col_schema.data_type.process_column(df[qualified], qualified, nullable=nullable)
        parsed_data[qualified] = parsed_series
        errors.extend(col_errors)


def process_dataframe(df: pd.DataFrame, schema: TableSchema) -> tuple[pd.DataFrame, list[dict]]:
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

    最终输出: Tuple[pd.DataFrame, list[dict]]
      - 第一个元素: 解析后的 DataFrame
      - 第二个元素: 错误字典列表，每项包含 row_index、column、value、error_type、error_message

    ============================================================================
    错误格式
    ============================================================================
    错误列表中的每个字典包含以下字段：
    - row_index: 行索引（整数或 None，None 表示整列级错误）
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
    # 展开 expand 列：将 pd.json_normalize 展平产生的点分列名（如 specs.brand）
    # 重构回原始 dict 列，以便后续 _expand_structured_columns 能正确处理
    df = _reconstruct_expand_columns(df, schema)

    # 使用 json_path 将 DataFrame 中的点分列名映射为 schema 定义的列名
    df = _map_json_path_columns(df, schema)

    # 存储解析后的列数据，键为列名，值为解析后的列表
    parsed_data: dict[str, list] = {}

    # 存储所有验证和解析过程中发现的错误
    errors: list[dict] = []

    # 记录原始 DataFrame 的行数，用于缺失列时填充空值
    num_rows = len(df)

    # 递归处理列:JsonObject 列跳过自身检查、递归叶子子列(全限定名校验)
    _process_columns_recursive(df, schema.columns, "", parsed_data, errors, num_rows)

    # 将解析后的列数据组装为 DataFrame，保留原始索引以维持行号对应关系
    parsed_df = pd.DataFrame(parsed_data, index=df.index)

    # 展开需要展开的结构化列（JSON 列）
    parsed_df = _expand_structured_columns(parsed_df, schema)

    return parsed_df, errors
