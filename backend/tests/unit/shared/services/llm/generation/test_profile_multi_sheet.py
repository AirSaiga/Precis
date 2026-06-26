"""@fileoverview 画像多 sheet Excel 支持测试

验证 _profile_files 正确处理多 sheet Excel：每个 sheet 产出独立 table 画像，
table_name 用 "文件名_sheet名" 区分。
"""

from __future__ import annotations

import pytest

from app.shared.services.llm.generation import ProfilingOptions
from app.shared.services.llm.generation.service import ConfigGenerationService

# 所有测试都是 async（_profile_files 是 async 方法）
pytestmark = pytest.mark.asyncio


def _make_service() -> ConfigGenerationService:
    """构造 service 实例（provider 在 _get_provider 时才需要，画像阶段不调用）。"""
    return ConfigGenerationService(provider_id=None)


async def test_profile_single_sheet_excel(tmp_path):
    """单 sheet Excel 产出单个画像，table_name 不带 sheet 后缀。"""
    import pandas as pd

    xlsx = tmp_path / "data.xlsx"
    with pd.ExcelWriter(xlsx) as writer:
        pd.DataFrame({"col_a": [1, 2], "col_b": ["x", "y"]}).to_excel(writer, sheet_name="Sheet1", index=False)

    service = _make_service()
    results = await service._profile_files([str(xlsx)], ProfilingOptions(sample_rows=10))

    assert len(results) == 1
    assert results[0]["table_name"] == "data"  # 单 sheet 不带后缀
    assert results[0]["sheet_name"] == "Sheet1"
    assert {c["name"] for c in results[0]["columns"]} == {"col_a", "col_b"}


async def test_profile_multi_sheet_excel(tmp_path):
    """多 sheet Excel 每个 sheet 产出独立画像，table_name 带后缀区分。"""
    import pandas as pd

    xlsx = tmp_path / "workbook.xlsx"
    with pd.ExcelWriter(xlsx) as writer:
        pd.DataFrame({"id": [1, 2], "name": ["a", "b"]}).to_excel(writer, sheet_name="users", index=False)
        pd.DataFrame({"order_id": [10, 20], "amount": [100, 200]}).to_excel(writer, sheet_name="orders", index=False)

    service = _make_service()
    results = await service._profile_files([str(xlsx)], ProfilingOptions(sample_rows=10))

    assert len(results) == 2  # 两个 sheet 各一个画像
    table_names = {r["table_name"] for r in results}
    assert table_names == {"workbook_users", "workbook_orders"}
    # sheet_name 对应
    by_table = {r["table_name"]: r for r in results}
    assert by_table["workbook_users"]["sheet_name"] == "users"
    assert by_table["workbook_orders"]["sheet_name"] == "orders"
    # 列正确归属各自 sheet
    assert {c["name"] for c in by_table["workbook_users"]["columns"]} == {"id", "name"}
    assert {c["name"] for c in by_table["workbook_orders"]["columns"]} == {"order_id", "amount"}


async def test_profile_csv_unchanged(tmp_path):
    """CSV 保持单画像行为，sheet_name 为 None。"""
    csv = tmp_path / "data.csv"
    csv.write_text("a,b\n1,2\n3,4\n", encoding="utf-8")

    service = _make_service()
    results = await service._profile_files([str(csv)], ProfilingOptions(sample_rows=10))

    assert len(results) == 1
    assert results[0]["sheet_name"] is None
    assert results[0]["table_name"] == "data"
