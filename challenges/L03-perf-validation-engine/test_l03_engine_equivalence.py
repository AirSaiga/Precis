"""
L03 隐藏行为测试 — 校验引擎吞吐优化后的结果等价 golden 对比。

本文件由 challenges/L03-perf-validation-engine/verify.py 临时注入到
backend/tests/unit/test_l03_engine_equivalence.py 后以 pytest 运行，verify 完成后清理。

golden 均为手工计算的期望结果（按 error_type/table/row_index/column 归一化后做集合对比，
不比对 message 文案），覆盖 None/NaN、跨块重复、空表/全空列、table_filter 跳过、
遇错即停等边缘。任何吞吐优化都必须让这些 golden 保持通过（结果等价）。
"""

from __future__ import annotations

import pandas as pd

from app.shared.domain.constraints import (
    AllowedValuesConstraint,
    CharsetConstraint,
    ForeignKeyConstraints,
    NotNullConstraint,
    RangeConstraint,
    UniqueConstraint,
)
from app.shared.domain.data_types import StringType
from app.shared.domain.dataset_schema import ColumnSchema, DataSetSchema, TableSchema
from app.shared.services.validation.engine import validate_constraints


def _norm_errors(all_errors: list[dict]) -> set[tuple]:
    """把错误列表归一化为 (error_type, table, row_index, column) 集合。"""
    out = set()
    for e in all_errors:
        col = e.get("column")
        if col is None and isinstance(e.get("columns"), list):
            col = e["columns"][0]
        out.add((e.get("error_type"), e.get("table"), e.get("row_index"), col))
    return out


def _make_schema(tables: dict[str, pd.DataFrame], constraints: list) -> DataSetSchema:
    """按表构造 DataSetSchema（列类型宽松：全部 string，够约束用）。"""
    table_schemas = {}
    for tid, df in tables.items():
        table_schemas[tid] = TableSchema(
            id=tid,
            name=tid,
            columns=[
                ColumnSchema(name=c, id=c, data_type=StringType()) for c in df.columns
            ],
        )
    return DataSetSchema(tables=table_schemas, constraints=constraints)


# ============================================================================
# 场景 1：混合基础约束 + None/NaN 边缘
# ============================================================================


def test_mixed_basic_constraints_with_nulls():
    df = pd.DataFrame(
        {
            "id": [1, 2, 2, 4, None],
            "status": ["a", "b", "a", None, "a"],
            "age": [10, 200, 30, 40, -5],
            "code": ["ABC", "中文", "abc", None, "123"],
        }
    )
    schema = _make_schema(
        {"main": df},
        [
            NotNullConstraint(table="main", column="status"),
            AllowedValuesConstraint(
                table="main", column="status", allowed_values={"a", "b"}
            ),
            RangeConstraint(table="main", column="age", min_value=0.0, max_value=150.0),
            UniqueConstraint(table="main", column="id"),
            CharsetConstraint(table="main", column="code", charset_mode="ascii"),
        ],
    )
    golden = {
        # status=None 违规；AllowedValues 对空值豁免、无其它违规
        ("NotNullViolation", "main", 3, "status"),
        # age: 200 与 -5 越界
        ("RangeViolation", "main", 1, "age"),
        ("RangeViolation", "main", 4, "age"),
        # id: 两处 2 均报重复；None 豁免
        ("UniqueViolation", "main", 1, "id"),
        ("UniqueViolation", "main", 2, "id"),
        # code: 只有 "中文" 非 ASCII；None 豁免
        ("CharsetViolation", "main", 1, "code"),
    }

    all_errors, details = validate_constraints({"main": df}, schema)

    assert _norm_errors(all_errors) == golden, (
        f"结果不等价: {sorted(_norm_errors(all_errors))}"
    )
    assert len(details["constraint_checks"]) == 5


# ============================================================================
# 场景 2：跨表 FK + 空表/全空列 + table_filter 跳过约束
# ============================================================================


def test_fk_empty_table_allnull_and_table_filter():
    users = pd.DataFrame({"id": [1, 2, 3], "label": ["A", "B", "C"]})
    orders = pd.DataFrame(
        {
            "user_id": ["1", "2", "9", None, "", float("nan")],
            "qty": [1, 2, 3, 4, 5, 6],
        }
    )
    empty_t = pd.DataFrame({"x": []})
    allnull = pd.DataFrame({"code": [None, None, None]})

    schema = _make_schema(
        {"users": users, "orders": orders, "empty_t": empty_t, "allnull": allnull},
        [
            ForeignKeyConstraints(
                from_table="orders",
                from_column="user_id",
                to_table="users",
                to_column="id",
            ),
            NotNullConstraint(table="orders", column="user_id"),
            # 空表上约束列缺失 → 配置错误（仅在不过滤时出现）
            RangeConstraint(table="empty_t", column="y", min_value=0.0),
            # 全空列唯一 → 0 违规（SQL 空值豁免语义）
            UniqueConstraint(table="allnull", column="code"),
        ],
    )

    # 无过滤：全部约束执行
    all_errors, _ = validate_constraints(
        {"users": users, "orders": orders, "empty_t": empty_t, "allnull": allnull},
        schema,
    )
    golden_all = {
        ("ForeignKeyViolation", "orders", 2, "user_id"),  # "9" 不在父表
        ("NotNullViolation", "orders", 3, "user_id"),  # None
        ("NotNullViolation", "orders", 4, "user_id"),  # 空串视为空
        ("NotNullViolation", "orders", 5, "user_id"),  # NaN
        ("ConstraintConfigError", "empty_t", None, "y"),
    }
    assert _norm_errors(all_errors) == golden_all, (
        f"结果不等价: {sorted(_norm_errors(all_errors))}"
    )

    # table_filter={"orders"}：users/allnull/empty_t 上的约束被跳过
    filtered, _ = validate_constraints(
        {"users": users, "orders": orders, "empty_t": empty_t, "allnull": allnull},
        schema,
        table_filter={"orders"},
    )
    golden_filtered = {
        ("ForeignKeyViolation", "orders", 2, "user_id"),
        ("NotNullViolation", "orders", 3, "user_id"),
        ("NotNullViolation", "orders", 4, "user_id"),
        ("NotNullViolation", "orders", 5, "user_id"),
    }
    assert _norm_errors(filtered) == golden_filtered, (
        f"结果不等价: {sorted(_norm_errors(filtered))}"
    )


# ============================================================================
# 场景 3：跨块合并后的重复检出 + 遇错即停语义
# ============================================================================


def test_cross_chunk_unique_and_stop_on_first_error():
    # 模拟分块解析后 concat 的全局数据（重复键跨"块边界"分布）
    chunk_a = pd.DataFrame(
        {
            "key": [f"k{i:02d}" for i in range(100)],
            "other": [f"o{i:02d}" for i in range(100)],
        }
    )
    chunk_b = pd.DataFrame(
        {
            "key": [f"k{i:02d}" for i in range(100, 200)],
            "other": [f"o{i:02d}" for i in range(100, 200)],
        }
    )
    chunk_a.loc[50, "key"] = "dup"
    chunk_b.loc[50, "key"] = "dup"
    chunk_a.loc[75, "key"] = None
    chunk_b.loc[75, "key"] = float("nan")
    merged = pd.concat([chunk_a, chunk_b], ignore_index=True)

    schema = _make_schema(
        {"main": merged},
        [
            # 干净的列，确保首个约束通过
            NotNullConstraint(table="main", column="other"),
            UniqueConstraint(table="main", column="key"),
            # 若被执行会产生大量违规——stop 语义下不应被执行
            AllowedValuesConstraint(
                table="main", column="key", allowed_values={"k00", "k01", "k02"}
            ),
        ],
    )

    all_errors, details = validate_constraints(
        {"main": merged}, schema, stop_on_first_error=True
    )

    golden = {
        # NotNull 无违规；Unique 检出跨块重复（None/NaN 豁免）
        ("UniqueViolation", "main", 50, "key"),
        ("UniqueViolation", "main", 150, "key"),
        # 遇错即停：首个约束错误后追加中断标记
        ("ValidationInterrupted", None, None, None),
    }
    assert _norm_errors(all_errors) == golden, (
        f"结果不等价: {sorted(_norm_errors(all_errors))}"
    )

    # 中断后剩余约束（AllowedValues）不得执行
    assert len(details["constraint_checks"]) == 2
    assert details["constraint_checks"][0]["constraint_type"] == "NotNullConstraint"
    assert details["constraint_checks"][0]["passed"] is True
    assert details["constraint_checks"][1]["constraint_type"] == "UniqueConstraint"
    assert details["constraint_checks"][1]["passed"] is False
