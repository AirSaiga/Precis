"""@fileoverview Agent Planner 单元测试

覆盖分块策略：按文件、按列、单一 chunk。
"""

from __future__ import annotations

from app.shared.services.ai.agent.planner import build_chunk_plan


def _make_profiling(table_name: str, path: str, columns: list[str]):
    return {
        "table_name": table_name,
        "path": path,
        "columns": [{"name": c, "dtype": "object"} for c in columns],
    }


def test_single_chunk_for_small_data():
    data = [
        _make_profiling("users", "data/users.csv", ["id", "email"]),
    ]
    plan = build_chunk_plan(data, ["data/users.csv"], max_columns_per_chunk=20, max_files_per_chunk=5)
    assert plan.strategy == "single"
    assert len(plan.chunks) == 1


def test_chunk_by_file():
    data = [_make_profiling(f"t{i}", f"data/t{i}.csv", ["id"]) for i in range(10)]
    plan = build_chunk_plan(
        data, [f"data/t{i}.csv" for i in range(10)], max_columns_per_chunk=20, max_files_per_chunk=5
    )
    assert plan.strategy == "by_file"
    assert len(plan.chunks) == 2


def test_chunk_by_column():
    data = [
        _make_profiling("big", "data/big.csv", [f"col_{i}" for i in range(30)]),
    ]
    plan = build_chunk_plan(data, ["data/big.csv"], max_columns_per_chunk=20, max_files_per_chunk=5)
    assert plan.strategy == "by_column"
    assert len(plan.chunks) == 2


def test_chunk_preserves_file_paths():
    data = [
        _make_profiling("users", "data/users.csv", ["id", "email"]),
        _make_profiling("orders", "data/orders.csv", ["id", "amount"]),
    ]
    plan = build_chunk_plan(
        data, ["data/users.csv", "data/orders.csv"], max_columns_per_chunk=20, max_files_per_chunk=5
    )
    assert plan.strategy == "single"
    assert set(plan.chunks[0].file_paths) == {"data/users.csv", "data/orders.csv"}
