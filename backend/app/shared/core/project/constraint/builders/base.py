"""@fileoverview 约束构建器基类与共享工具

定义 BuilderInput / BuilderResult / BuilderFn 协议，以及各构建器共享的辅助函数。

架构设计（参考前端 nodeDataBuilder/registry.ts 的可注册构建器模式）：
- 每种约束类型的构建逻辑封装为独立 BuilderFn
- 共享的单列映射逻辑提取为 resolve_single_column，消除 NotNull/AllowedValues/
  DateLogic/Range/Charset 之间的重复代码
"""

from __future__ import annotations

from collections.abc import Callable
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from ..schema.types import TableSchemaFile
    from ..types import ConstraintFile


class BuilderInput:
    """构建器输入上下文（所有 BuilderFn 共享）。

    封装 refs/params/const_id/column_map/schema_files，以及 Composite 递归所需的
    create_child 回调（依赖注入，避免 builder 直接 import factory 形成循环依赖）。
    """

    def __init__(
        self,
        const: ConstraintFile,
        refs: dict[str, Any],
        params: dict[str, Any],
        column_name_by_table_id: dict[str, dict[str, str]],
        schema_files: dict[str, TableSchemaFile],
        create_child: Callable[[ConstraintFile, dict[str, TableSchemaFile]], tuple[Any | None, str | None]],
    ) -> None:
        self.const = const
        self.refs = refs
        self.params = params
        self.column_name_by_table_id = column_name_by_table_id
        self.schema_files = schema_files
        self.create_child = create_child

    @property
    def const_id(self) -> str:
        return self.const.id


# 构建结果：(kwargs, error)。成功时 error 为 None；失败时 kwargs 为空字典。
BuilderResult = tuple[dict[str, Any], str | None]

# 构建器函数签名：接收 BuilderInput，返回 BuilderResult
BuilderFn = Callable[[BuilderInput], BuilderResult]


def resolve_single_column(
    inp: BuilderInput,
    table_key: str = "table_id",
    col_key: str = "column_id",
) -> BuilderResult:
    """单列映射共享逻辑（NotNull/AllowedValues/DateLogic/Range/Charset 共用）。

    从 refs 提取 table_id 和 column_id，映射为 table_id（保持稳定）和 column_name。
    映射失败时返回错误。
    """
    table_id = inp.refs.get(table_key)
    col_id = inp.refs.get(col_key)
    if table_id is None:
        return {}, f"缺少 {table_key}"
    if col_id is None:
        return {}, f"缺少 {col_key}"

    col_name = inp.column_name_by_table_id.get(table_id, {}).get(col_id)
    if col_name is None:
        return {}, f"引用的列 '{col_id}' 不存在于表 '{table_id}' 中"

    return {"table": table_id, "column": col_name}, None
