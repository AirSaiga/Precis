"""CLI 独立校验回归测试。

复用 qa_test/golden/*/ 案例作为输入，in-process 调用 cli_main 验证 standalone validate 模式。
不使用 subprocess（沿用 test_cli_smoke.py 的 in-process 模式）。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND_ROOT))

from app.cli.shell.main import main as cli_main

GOLDEN_ROOT = Path(__file__).resolve().parents[3] / "qa_test" / "golden"


def _golden_cases() -> list[Path]:
    """发现所有黄金案例目录。"""
    if not GOLDEN_ROOT.is_dir():
        return []
    return sorted(p for p in GOLDEN_ROOT.iterdir() if (p / "expected.json").exists())


CASES = _golden_cases()


@pytest.mark.parametrize("case_dir", CASES, ids=[p.name for p in CASES])
def test_cli_validate_matches_golden(case_dir):
    """每个黄金案例通过 CLI standalone validate 应产出与 expected.json 一致的退出码。

    - expect_success=true 且错误数>0 → cli_main 应返回非 0（CommandResult.error）
    - expect_success=true 且错误数=0 → cli_main 应返回 0（CommandResult.ok）
    - expect_success=false → cli_main 应抛异常或返回非 0
    """
    if not CASES:
        pytest.skip("黄金案例未找到，请先完成 Task 4/5")

    manifest = str(case_dir / "project.precis.yaml")
    data_dir = str(case_dir / "data")
    with open(case_dir / "expected.json", encoding="utf-8") as f:
        expected = json.load(f)

    args = ["validate", "--manifest", manifest, "--data-directory", data_dir]
    rc = cli_main(args)

    expected_error_count = expected["expected_error_count_min"]
    if expected.get("expect_success", True):
        if expected_error_count > 0:
            # 有校验错误 → CLI 返回非 0（CommandResult.error）
            assert rc != 0, f"{case_dir.name}: 预期非 0（{expected_error_count} 个错误），实际 {rc}"
        else:
            # 无错误 → CLI 返回 0
            assert rc == 0, f"{case_dir.name}: 预期 0（无错误），实际 {rc}"
    else:
        # 期望失败 → 非 0
        assert rc != 0, f"{case_dir.name}: 预期失败（非 0），实际 {rc}"


def test_cli_validate_table_filter():
    """--table 过滤只校验指定表。"""
    if not CASES:
        pytest.skip("黄金案例未找到")
    # 用 07_foreign_key（含 2 个 schema）验证 table 过滤
    fk_case = GOLDEN_ROOT / "07_foreign_key"
    if not fk_case.is_dir():
        pytest.skip("07_foreign_key 案例未找到")
    rc = cli_main(
        [
            "validate",
            "--manifest",
            str(fk_case / "project.precis.yaml"),
            "--data-directory",
            str(fk_case / "data"),
            "--table",
            "orders",
        ]
    )
    # 只校验 orders 表，应仍发现 fk 违规 → 非 0
    assert rc != 0


def test_cli_validate_missing_manifest_returns_error():
    """manifest 路径不存在应优雅返回错误（非崩溃）。"""
    rc = cli_main(["validate", "--manifest", "/nonexistent/path.yaml"])
    assert rc != 0


def test_cli_validate_nonexistent_data_dir_returns_error():
    """数据目录不存在应优雅返回错误。"""
    import tempfile

    with tempfile.TemporaryDirectory() as td:
        manifest = Path(td) / "project.precis.yaml"
        manifest.write_text(
            'version: 2\nproject:\n  id: x\n  name: "x"\nschemas: []\nconstraints: []\ndata_sources: []\n',
            encoding="utf-8",
        )
        rc = cli_main(
            [
                "validate",
                "--manifest",
                str(manifest),
                "--data-directory",
                str(Path(td) / "no_such_dir"),
            ]
        )
        assert rc != 0


def test_cli_validate_error_handling_stop():
    """error_handling=stop 模式下应遇错即停（C6 修复点）。"""
    stop_case = GOLDEN_ROOT / "17_error_handling_stop"
    if not stop_case.is_dir():
        pytest.skip("17_error_handling_stop 案例未找到")
    with open(stop_case / "expected.json", encoding="utf-8") as f:
        expected = json.load(f)
    # stop 模式应只报首个错误（实际是首个约束的全部行违规）→ 非 0
    rc = cli_main(
        [
            "validate",
            "--manifest",
            str(stop_case / "project.precis.yaml"),
            "--data-directory",
            str(stop_case / "data"),
        ]
    )
    assert rc != 0
    # expected_interrupted 应为 true（已在 golden check 校验，这里只确认 CLI 也能跑通）
    assert expected.get("expected_interrupted") is True
