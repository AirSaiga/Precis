"""
@fileoverview 约束实例化工厂模块

功能概述:
- 根据 ConstraintFile 配置创建运行时约束对象
- 处理约束引用解析（table_id -> table_name, column_id -> column_name）
- 支持批量创建多个约束对象

架构设计:
- 工厂模式: 根据约束类型名称动态实例化对应约束类
- 依赖注册表: 使用 registry.py 获取约束类型到实现类的映射
- 参数过滤: 使用 filter_kwargs_for_class 过滤仅构造函数接受的参数

输入示例:
    constraint = ConstraintFile(
        version=2,
        id="unique_email",
        type="Unique",
        enabled=True,
        refs={"table_id": "users", "column_ids": ["email"]},
        params={},
    )

输出示例:
    runtime_constraint, error = create_constraint(constraint, schema_files)
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from ..schema.types_parts.column_utils import build_column_id_to_name_map

# 导入约束注册表和工具函数，用于根据类型名称查找约束类并过滤参数
from .registry import filter_kwargs_for_class, normalize_constraint_type, resolve_constraint_class
from .types import ConstraintFile

if TYPE_CHECKING:
    # 仅在类型检查阶段导入 Schema 类型，避免运行时循环依赖
    from ..schema.types import TableSchemaFile
    from .types import ConstraintFile


def create_constraint(
    const: ConstraintFile,
    schema_files: dict[str, TableSchemaFile],
) -> tuple[Any | None, str | None]:
    """
    @methoddesc 根据 ConstraintFile 创建运行时约束对象。

    该函数执行以下步骤：
    1. 检查约束是否启用，未启用则返回 None
    2. 规范化约束类型名称，从注册表获取对应的约束类
    3. 提取 refs 和 params 数据
    4. 构建 table_id -> table_name 和 column_id -> column_name 的映射
    5. 根据约束类型，从 refs 中提取 ID 并映射为实际名称
    6. 从 params 中提取额外参数
    7. 过滤参数，只保留约束类构造函数接受的参数
    8. 实例化约束类并返回

    :param const: ConstraintFile 配置对象，包含约束的完整配置
    :param schema_files: schema 文件字典，键为 table_id，值为 TableSchemaFile 对象
    :return: (约束实例对象, 错误信息)。若成功，错误信息为 None；若失败，实例为 None；若未启用，两者均为 None。
    :raises ValueError: 不支持的约束类型时抛出
    """
    # 步骤1：检查约束是否启用，未启用则跳过
    if not const.enabled:
        return None, None

    # 步骤2：规范化约束类型名称（如 "unique" -> "Unique"）
    # 从注册表延迟解析对应的约束类
    type_name = normalize_constraint_type(const.type)
    constraint_class = resolve_constraint_class(type_name)
    if constraint_class is None:
        return None, f"不支持的约束类型: {const.type}（规范化后: {type_name}）"

    # 步骤3：提取 refs 和 params 数据
    refs = const.refs or {}
    params = const.params or {}

    # 初始化 kwargs 字典，用于构造约束类实例
    kwargs: dict[str, Any] = {}

    # 构建 column_id -> column_name 映射表（按 table_id 分组,递归含嵌套 children）
    # 结构：{table_id: {column_id: column_name, ...}, ...}
    # 注:递归遍历确保 JSON 嵌套子列上的约束也能解析列引用
    column_name_by_table_id: dict[str, dict[str, str]] = {
        sid: build_column_id_to_name_map(s.columns) for sid, s in schema_files.items()
    }

    # 检查约束引用的表是否存在
    table_id = refs.get("table_id") or refs.get("from_table_id")
    if table_id and table_id not in schema_files:
        return None, f"引用的表 '{table_id}' 不存在（可能已被删除）"

    # 步骤5-6：根据约束类型，提取并映射 refs 中的 ID 为实际名称
    # 同时从 params 中提取额外参数

    # === 唯一约束（Unique）处理 ===
    # refs: {table_id, column_ids} 或 {table_id, column_id}
    # params: {}
    if type_name == "Unique":
        table_id = refs.get("table_id")
        col_id = refs.get("column_ids") or refs.get("column_id")
        if not isinstance(table_id, str):
            return None, "缺少 table_id"
        # 确保 col_id 是列表
        if isinstance(col_id, str):
            col_id = [col_id]
        elif not col_id:
            col_id = []

        # 直接使用 table_id（保证稳定性）
        kwargs["table"] = table_id
        # 映射 column_ids -> column_names
        mapped_cols = [column_name_by_table_id.get(table_id, {}).get(str(cid)) for cid in col_id]
        if None in mapped_cols:
            invalid_cols = [cid for cid, name in zip(col_id, mapped_cols) if name is None]
            return None, f"引用的列不存在: {invalid_cols}"
        kwargs["column"] = mapped_cols

    # === 非空约束（NotNull）处理 ===
    # refs: {table_id, column_id}
    # params: {}
    elif type_name == "NotNull":
        table_id = refs.get("table_id")
        col_id = refs.get("column_id")
        if table_id is None:
            return None, "缺少 table_id"
        if col_id is None:
            return None, "缺少 column_id"
        # 直接使用 table_id（保证稳定性）
        kwargs["table"] = table_id
        col_name = column_name_by_table_id.get(table_id, {}).get(col_id)
        if col_name is None:
            return None, f"引用的列 '{col_id}' 不存在于表 '{table_id}' 中"
        kwargs["column"] = col_name

    # === 允许值约束（AllowedValues）处理 ===
    # refs: {table_id, column_id}
    # params: {allowed_values}
    elif type_name == "AllowedValues":
        table_id = refs.get("table_id")
        col_id = refs.get("column_id")
        if table_id is None:
            return None, "缺少 table_id"
        if col_id is None:
            return None, "缺少 column_id"
        # 直接使用 table_id（保证稳定性）
        kwargs["table"] = table_id
        col_name = column_name_by_table_id.get(table_id, {}).get(col_id)
        if col_name is None:
            return None, f"引用的列 '{col_id}' 不存在于表 '{table_id}' 中"
        kwargs["column"] = col_name
        # 从 params 中提取允许值列表
        kwargs["allowed_values"] = params.get("allowed_values", [])

    # === 外键约束（ForeignKey）处理 ===
    # refs: {from_table_id, from_column_id, to_table_id, to_column_id}
    # params: {}
    elif type_name == "ForeignKey":
        from_table_id = refs.get("from_table_id")
        from_col_id = refs.get("from_column_id")
        to_table_id = refs.get("to_table_id")
        to_col_id = refs.get("to_column_id")

        # 检测配置键名错误
        if from_table_id is None or to_table_id is None:
            return None, "缺少必要的表引用"

        from_col_name = column_name_by_table_id.get(from_table_id, {}).get(str(from_col_id))
        to_col_name = column_name_by_table_id.get(to_table_id, {}).get(str(to_col_id))

        if from_col_name is None:
            return None, f"引用的列 '{from_col_id}' 不存在于表 '{from_table_id}' 中"
        if to_col_name is None:
            return None, f"引用的列 '{to_col_id}' 不存在于表 '{to_table_id}' 中"

        # 直接使用 table_id（保证稳定性）
        kwargs["from_table"] = from_table_id
        kwargs["from_column"] = from_col_name
        kwargs["to_table"] = to_table_id
        kwargs["to_column"] = to_col_name

    # === 条件约束（Conditional）处理 ===
    # refs: {table_id, then_column_id, if_conditions, if_logic}
    # params: {then_condition}
    elif type_name == "Conditional":
        table_id = refs.get("table_id")
        then_col_id = refs.get("then_column_id")
        if table_id is None:
            return None, "缺少 table_id"
        if then_col_id is None:
            return None, "缺少 then_column_id"
        if_logic = refs.get("if_logic", "and")
        if_conditions = refs.get("if_conditions") or []

        # 列名映射：优先从 schema 查找，找不到则直接使用 column_id
        # （支持 transform 生成的派生列，这些列不在原始 schema 中）
        then_col_name = column_name_by_table_id.get(table_id, {}).get(then_col_id) or then_col_id

        # 处理 IF 条件列表，将 column_id 映射为 column_name
        normalized_conditions: list[dict[str, Any]] = []
        for cond in if_conditions:
            if_col_id = cond.get("if_column_id")
            if_col_name = column_name_by_table_id.get(table_id, {}).get(if_col_id) or if_col_id
            normalized_conditions.append(
                {
                    "if_column": if_col_name,
                    "operator": cond.get("operator", "eq"),
                    "value": cond.get("value"),
                    "values": cond.get("values"),
                }
            )

        # 直接使用 table_id（保证稳定性）
        kwargs["table"] = table_id
        kwargs["then_column"] = then_col_name
        kwargs["then_condition"] = params.get("then_condition")
        kwargs["if_conditions"] = normalized_conditions
        kwargs["if_logic"] = if_logic

    # === 日期逻辑约束（DateLogic）处理 ===
    # refs: {table_id, column_id}
    # params: {logic_mode, compare_op, reference_date, reference_column, calculation_type, target_value, target_column}
    elif type_name == "DateLogic":
        table_id = refs.get("table_id")
        col_id = refs.get("column_id")
        if table_id is None:
            return None, "缺少 table_id"
        if col_id is None:
            return None, "缺少 column_id"
        # 直接使用 table_id（保证稳定性）
        kwargs["table"] = table_id
        col_name = column_name_by_table_id.get(table_id, {}).get(col_id)
        if col_name is None:
            return None, f"引用的列 '{col_id}' 不存在于表 '{table_id}' 中"
        kwargs["column"] = col_name
        # 将 params 中的所有参数添加到 kwargs
        # filter_kwargs_for_class 会自动过滤掉不需要的参数
        kwargs.update(params)

    # === 区间约束（Range）处理 ===
    # refs: {table_id, column_id}
    # params: {min, max, boundary_mode}
    elif type_name == "Range":
        table_id = refs.get("table_id")
        col_id = refs.get("column_id")
        if table_id is None:
            return None, "缺少 table_id"
        if col_id is None:
            return None, "缺少 column_id"
        # 直接使用 table_id（保证稳定性）
        kwargs["table"] = table_id
        col_name = column_name_by_table_id.get(table_id, {}).get(col_id)
        if col_name is None:
            return None, f"引用的列 '{col_id}' 不存在于表 '{table_id}' 中"
        kwargs["column"] = col_name

        # 映射 params 参数到构造函数参数
        # min -> min_value
        if "min" in params:
            kwargs["min_value"] = params["min"]
        # max -> max_value
        if "max" in params:
            kwargs["max_value"] = params["max"]
        # boundary_mode 直接传递
        if "boundary_mode" in params:
            kwargs["boundary_mode"] = params["boundary_mode"]

    # === 脚本约束（Scripted）处理 ===
    # refs: {table_id, column_id (optional)}
    # params: {name, expression}
    elif type_name == "Scripted":
        table_id = refs.get("table_id")
        col_id = refs.get("column_id")
        # 直接使用 table_id（保证稳定性）
        kwargs["table"] = table_id
        # 使用约束 ID 作为默认名称
        kwargs["name"] = params.get("name", const.id)
        # 从 params 中提取脚本表达式
        kwargs["expression"] = params.get("expression", "")
        # column_id 是可选的
        if col_id and isinstance(table_id, str):
            kwargs["column"] = column_name_by_table_id.get(table_id, {}).get(str(col_id))

    # === 复合约束（Composite）处理 ===
    # refs: {table_id} 等
    # params: {logic, sub_constraints: [ConstraintFile-like dict]}
    elif type_name == "Composite":
        sub_configs = params.get("sub_constraints", [])
        sub_constraints = []
        for sub_cfg in sub_configs:
            sub_type = normalize_constraint_type(sub_cfg.get("type", ""))
            if sub_type == "Composite":
                # 禁止递归嵌套 Composite
                continue
            sub_file = ConstraintFile.model_construct(
                version=sub_cfg.get("version", 2),
                id=sub_cfg.get("id", ""),
                type=sub_cfg.get("type", ""),
                enabled=sub_cfg.get("enabled", True),
                description=sub_cfg.get("description"),
                refs=sub_cfg.get("refs", {}),
                params=sub_cfg.get("params", {}),
                input_from_node=sub_cfg.get("input_from_node"),
            )
            sub_constraint, sub_error = create_constraint(sub_file, schema_files)
            if sub_constraint is not None:
                sub_constraints.append(sub_constraint)
            # sub_error 为 None 时可能是未启用，忽略即可

        kwargs["sub_constraints"] = sub_constraints
        kwargs["logic"] = params.get("logic", "all")
        kwargs["refs"] = refs

    # 步骤7：过滤 kwargs，只保留约束类构造函数接受的参数
    # 使用 inspect 签名检查，避免传入不存在的参数导致实例化失败
    filtered = filter_kwargs_for_class(constraint_class, kwargs)

    # 步骤8：实例化约束类并返回
    return constraint_class(**filtered), None


def create_constraints(
    constraint_files: dict[str, ConstraintFile],
    schema_files: dict[str, TableSchemaFile],
) -> tuple[list[Any], list[str]]:
    """
    @methoddesc 批量创建运行时约束对象。

    遍历所有约束配置文件，调用 create_constraint 进行转换，
    过滤掉未启用的约束，返回所有启用的约束实例列表。

    :param constraint_files: 约束配置字典，键为 constraint_id，值为 ConstraintFile 对象
    :param schema_files: schema 文件字典，键为 table_id，值为 TableSchemaFile 对象
    :return: (约束实例列表, 警告信息列表)
    """
    # 初始化结果列表
    constraints: list[Any] = []
    warnings: list[str] = []

    # 遍历所有约束配置
    for const in constraint_files.values():
        try:
            # 创建单个约束实例
            constraint, error = create_constraint(const, schema_files)
            # 仅添加非 None 的约束（即已启用的约束）
            if constraint is not None:
                constraints.append(constraint)
            elif error:
                # 收集警告信息
                warnings.append(f"约束 '{const.id}' 配置错误: {error}，已跳过")
            # else: 约束未启用，忽略
        except Exception as e:
            warnings.append(f"约束 '{const.id}' 实例化异常: {str(e)}，已跳过")

    return constraints, warnings
