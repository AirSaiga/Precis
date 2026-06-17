"""
@fileoverview 配置自检问题 ID 集中管理

功能概述:
- 集中定义所有自检问题（LoadingError.id）的拼接规则
- 作为前后端约定的单一事实来源，避免 id 格式散落各处导致不一致
- id 的稳定性直接影响前端"忽略"列表（localStorage）的持久化有效性

设计原则:
- 纯函数，无副作用
- 保持现有 id 格式不变（向后兼容已持久化的 ignore 列表）
- 每个工厂函数对应一种问题类型，命名见文知意

id 格式总览（前后端契约，请勿随意变更）:
    ID 不一致:        id_mismatch_{resource_type}:{manifest_id}:{file_id}
    重复登记约束:     id_mismatch_constraint:{manifest_id}:{file_id}
    引用表缺失:       {error_prefix}:{constraint_id}:{table_id}
    引用列缺失:       {error_prefix}:{constraint_id}:{table_id}:{column_id}
    正则表缺失:       regex_table_missing:{regex_id}:{table_id}
    正则列缺失:       regex_col_missing:{regex_id}:{table_id}:{column_id}
    Schema ID 重复:   schema_id_duplicate:{schema_id}
    数据源重复:        schema_source_duplicate:{path}:{sheet}
"""

from __future__ import annotations


def id_mismatch(resource_type: str, manifest_id: str, file_id: str) -> str:
    """ID 不一致问题 id（schema/constraint/regex/transform 通用）。"""
    return f"id_mismatch_{resource_type}:{manifest_id}:{file_id}"


def constraint_dup_ref(manifest_id: str, file_id: str) -> str:
    """同一条 constraint 被重复登记问题 id。"""
    return f"id_mismatch_constraint:{manifest_id}:{file_id}"


def ref_table_missing(error_prefix: str, constraint_id: str, table_id: str) -> str:
    """约束引用的表缺失问题 id。

    Args:
        error_prefix: 检查前缀（如 fk_src_table_missing / ref_table_missing），
            同时作为 fix_api.body.field 使用
    """
    return f"{error_prefix}:{constraint_id}:{table_id}"


def ref_column_missing(error_prefix: str, constraint_id: str, table_id: str, column_id: str) -> str:
    """约束引用的列缺失问题 id。"""
    return f"{error_prefix}:{constraint_id}:{table_id}:{column_id}"


def regex_table_missing(regex_id: str, table_id: str) -> str:
    """正则节点引用的表缺失问题 id。"""
    return f"regex_table_missing:{regex_id}:{table_id}"


def regex_column_missing(regex_id: str, table_id: str, column_id: str) -> str:
    """正则节点引用的列缺失问题 id。"""
    return f"regex_col_missing:{regex_id}:{table_id}:{column_id}"


def schema_id_duplicate(schema_id: str) -> str:
    """Schema ID 全局重复问题 id。"""
    return f"schema_id_duplicate:{schema_id}"


def schema_source_duplicate(path: str, sheet: str | None) -> str:
    """数据源重复问题 id。"""
    return f"schema_source_duplicate:{path}:{sheet}"
