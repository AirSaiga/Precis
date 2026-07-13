"""
@fileoverview 约束实例化工厂模块

功能概述:
- 根据 ConstraintFile 配置创建运行时约束对象
- 处理约束引用解析（table_id -> table_name, column_id -> column_name）
- 支持批量创建多个约束对象

架构设计:
- 工厂模式: 根据约束类型名称动态实例化对应约束类
- 可注册构建器: 各约束类型的参数构建逻辑封装在 builders/ 子包中，
  通过 @register_builder 自注册（参考前端 nodeDataBuilder 模式）
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

import logging
from typing import TYPE_CHECKING, Any

from ..schema.types_parts.column_utils import build_column_id_to_name_map

logger = logging.getLogger(__name__)

# 导入约束注册表和工具函数，用于根据类型名称查找约束类并过滤参数
# side-effect import 触发各 builder 的 @register_builder 注册
from . import builders as _builders  # noqa: F401
from .builders import BuilderInput, build_kwargs
from .registry import filter_kwargs_for_class, normalize_constraint_type, resolve_constraint_class
from .types import ConstraintFile

if TYPE_CHECKING:
    # 仅在类型检查阶段导入 Schema 类型，避免运行时循环依赖
    from ..schema.types import TableSchemaFile


def create_constraint(
    const: ConstraintFile,
    schema_files: dict[str, TableSchemaFile],
) -> tuple[Any | None, str | None]:
    """
    @methoddesc 根据 ConstraintFile 创建运行时约束对象。

    该函数执行以下步骤：
    1. 检查约束是否启用，未启用则返回 None
    2. 规范化约束类型名称，从注册表获取对应的约束类
    3. 构建 column_id -> column_name 映射 + BuilderInput 上下文
    4. 调用 build_kwargs 委托给各类型的注册构建器（消除 if-elif 链）
    5. 过滤参数，只保留约束类构造函数接受的参数
    6. 实例化约束类并返回

    :param const: ConstraintFile 配置对象，包含约束的完整配置
    :param schema_files: schema 文件字典，键为 table_id，值为 TableSchemaFile 对象
    :return: (约束实例对象, 错误信息)。若成功，错误信息为 None；若失败，实例为 None；若未启用，两者均为 None。
    """
    # 步骤1：检查约束是否启用，未启用则跳过
    if not const.enabled:
        return None, None

    # 步骤2：规范化约束类型名称（如 "unique" -> "Unique"），从注册表延迟解析对应的约束类
    type_name = normalize_constraint_type(const.type)
    constraint_class = resolve_constraint_class(type_name)
    if constraint_class is None:
        return None, f"不支持的约束类型: {const.type}（规范化后: {type_name}）"

    refs = const.refs or {}
    params = const.params or {}

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

    # 步骤3-4：构建 BuilderInput 并委托给注册构建器（Composite 的递归通过 create_child 回调注入）
    inp = BuilderInput(
        const=const,
        refs=refs,
        params=params,
        column_name_by_table_id=column_name_by_table_id,
        schema_files=schema_files,
        create_child=create_constraint,  # 依赖注入：Composite builder 用此回调递归，避免循环 import
    )
    result = build_kwargs(type_name, inp)
    if result is None:
        # 未注册的类型：返回错误（此前 Charset 走通用路径是隐性 bug，现已补 builder）
        return None, f"不支持的约束类型: {const.type}（规范化后: {type_name}）"
    kwargs, error = result
    if error:
        return None, error

    # 步骤5：过滤 kwargs，只保留约束类构造函数接受的参数
    filtered = filter_kwargs_for_class(constraint_class, kwargs)

    # 步骤6：实例化约束类并返回
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
