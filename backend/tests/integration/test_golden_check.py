"""golden_check.py 的单元测试。

验证案例发现、期望加载、校验逻辑、diff 报告。
用真实的最小案例（构造在 tmp_path）驱动，不 mock ValidationExecutor 的接口形状。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND_ROOT))

from scripts.golden_check import discover_cases, load_expected, run_case


def _make_minimal_case(case_dir: Path, expected: dict) -> None:
    """在 case_dir 构造一个最小的合法案例（manifest + schema + data + expected.json）。

    关键：必须声明至少一个 schema（带指向 CSV 的 source）和一个 data_source。
    ValidationExecutor 会迭代 dataset_schema.tables 来加载数据，
    若 raw_datasets 为空则报 DataLoadingError（"未能从数据目录加载任何数据表"）。
    无约束时校验结果为 0 错误。
    """
    case_dir.mkdir(parents=True, exist_ok=True)
    (case_dir / "data").mkdir(exist_ok=True)
    (case_dir / "data" / "users.csv").write_text("id,name\n1,Alice\n", encoding="utf-8")
    (case_dir / "schemas").mkdir(exist_ok=True)
    # 最小 schema：id + name + source(指向 CSV) + 一列定义，无内嵌约束
    (case_dir / "schemas" / "users.schema.yaml").write_text(
        "version: 2\n"
        "id: users\n"
        "name: users\n"
        "source:\n"
        "  mode: relative_file\n"
        "  path: data/users.csv\n"
        "columns:\n"
        "  - id: id\n"
        "    name: id\n"
        "    type: integer\n"
        "  - id: name\n"
        "    name: name\n"
        "    type: string\n",
        encoding="utf-8",
    )
    (case_dir / "project.precis.yaml").write_text(
        "version: 2\n"
        "project:\n"
        "  id: test-project\n"
        '  name: "Test"\n'
        "schemas:\n"
        "  - id: users\n"
        "    path: schemas/users.schema.yaml\n"
        "constraints: []\n"
        "data_sources:\n"
        "  - id: primary\n"
        "    path: data\n"
        "    mode: relative\n"
        "    description: 主数据目录\n",
        encoding="utf-8",
    )
    with open(case_dir / "expected.json", "w", encoding="utf-8") as f:
        json.dump(expected, f, ensure_ascii=False, indent=2)


def test_discover_cases_finds_expected_json_dirs(tmp_path, monkeypatch):
    """discover_cases 只返回含 expected.json 的目录。"""
    _make_minimal_case(
        tmp_path / "01_one",
        {
            "case_id": "01_one",
            "expect_success": True,
            "expected_error_count_min": 0,
            "expected_error_count_max": 0,
            "expected_error_types": [],
            "expected_violations": [],
            "expected_loading_error_types": [],
        },
    )
    (tmp_path / "02_empty").mkdir()
    monkeypatch.setattr("scripts.golden_check.GOLDEN_ROOT", tmp_path)
    cases = discover_cases()
    assert len(cases) == 1
    assert cases[0].name == "01_one"


def test_load_expected_reads_json(tmp_path):
    """load_expected 正确解析 expected.json。"""
    expected = {
        "case_id": "x",
        "expect_success": True,
        "expected_error_count_min": 0,
        "expected_error_count_max": 0,
        "expected_error_types": [],
        "expected_violations": [],
        "expected_loading_error_types": [],
    }
    _make_minimal_case(tmp_path / "x", expected)
    loaded = load_expected(tmp_path / "x")
    assert loaded["case_id"] == "x"


def test_run_case_passes_on_empty_project(tmp_path, monkeypatch):
    """空 manifest（无约束）应校验通过、0 错误。"""
    case_dir = tmp_path / "01_empty"
    _make_minimal_case(
        case_dir,
        {
            "case_id": "01_empty",
            "description": "空项目",
            "expect_success": True,
            "expected_error_count_min": 0,
            "expected_error_count_max": 0,
            "expected_error_types": [],
            "expected_violations": [],
            "expected_loading_error_types": [],
        },
    )
    result = run_case(case_dir)
    assert result.passed, f"应通过但失败: {result.failures}"
    assert result.actual_error_count == 0


def test_run_case_fails_when_error_count_out_of_range(tmp_path):
    """错误数超出区间应失败。"""
    case_dir = tmp_path / "02_count_mismatch"
    _make_minimal_case(
        case_dir,
        {
            "case_id": "02_count_mismatch",
            "expect_success": True,
            "expected_error_count_min": 5,
            "expected_error_count_max": 5,
            "expected_error_types": [],
            "expected_violations": [],
            "expected_loading_error_types": [],
        },
    )
    result = run_case(case_dir)
    assert not result.passed
    assert any("错误数" in f or "count" in f.lower() for f in result.failures)
