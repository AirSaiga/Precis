"""L03 verify — 多级评分：校验引擎吞吐优化（结果等价 + 吞吐档 + 回归 + 质量）。

评分契约：
- stdout 首行 `SCORE: n/m`（n=得分，m=满分 9）
- 后续逐行 `  [i/j] 子项名：说明`
- 退出码 0 = 评分完成；仅环境异常才非 0
- finally 清理注入的测试文件与 __pycache__

评分项：
  1. 结果等价（3 分）——注入 golden 对比测试 3 个场景各 1 分（仅当 backend 存在改动时计分）
  2. 吞吐档（3 分）——固定 fixture（80 万行 × 8 约束）子进程实测，三档阈值
  3. 回归门（2 分）——validat* 簇既有测试相关子集全绿
  4. 质量（1 分）——改动文件 ruff
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(HERE))
BACKEND_DIR = os.path.join(REPO_ROOT, "backend")
BACKEND_TESTS_UNIT = os.path.join(BACKEND_DIR, "tests", "unit")
TEST_SRC = os.path.join(HERE, "test_l03_engine_equivalence.py")
TEST_DST = os.path.join(BACKEND_TESTS_UNIT, "test_l03_engine_equivalence.py")

# 结果等价场景（注入测试的 3 个测试函数，各 1 分）
EQUIVALENCE_TESTS = [
    "test_mixed_basic_constraints_with_nulls",
    "test_fk_empty_table_allnull_and_table_filter",
    "test_cross_chunk_unique_and_stop_on_first_error",
]

# 回归门：validat* 簇既有测试相关子集（相对 BACKEND_DIR）
REGRESSION_TARGETS = [
    os.path.join("tests", "unit", "test_validation_engine_behavior.py"),
    os.path.join("tests", "unit", "test_validate_executor.py"),
    os.path.join("tests", "unit", "test_validation_service.py"),
    os.path.join("tests", "unit", "test_validation_service_behavior.py"),
    os.path.join("tests", "unit", "test_validation_constraints_imports.py"),
    os.path.join("tests", "unit", "test_charset_constraint.py"),
    os.path.join("tests", "unit", "test_allowed_values_constraint.py"),
    os.path.join("tests", "unit", "test_range_constraint.py"),
    os.path.join("tests", "unit", "test_not_null_constraint.py"),
    os.path.join("tests", "unit", "test_unique_constraint.py"),
    os.path.join("tests", "unit", "test_foreign_key_constraint.py"),
    os.path.join("tests", "unit", "test_conditional_constraint.py"),
    os.path.join("tests", "unit", "test_composite_constraint.py"),
    os.path.join("tests", "unit", "test_constraint_base.py"),
]

# 吞吐档阈值（秒，best-of-3）：T1=3 分，T2=2 分，T3=1 分
# 定档依据（出题机实测）：未实现 ≈2.8-3.0s，参考答案 ≈1.4-1.7s
PERF_T1_S = 1.85
PERF_T2_S = 2.30
PERF_T3_S = 2.60

# 固定 fixture：80 万行 × 8 约束（混合类型、稀疏违规、含 Charset/FK 等扫描热点）
FIXTURE_ROWS = 800_000

# 子进程基准脚本：固定 fixture，1 次预热 + 3 次计时取最优，输出 BEST: <秒>
BENCH_SCRIPT = r"""
import os
import sys
import time

sys.path.insert(0, os.environ["PRECIS_BACKEND"])

import numpy as np
import pandas as pd

from app.shared.domain.constraints import (
    AllowedValuesConstraint,
    CharsetConstraint,
    ForeignKeyConstraints,
    NotNullConstraint,
    RangeConstraint,
    UniqueConstraint,
)
from app.shared.domain.dataset_schema import ColumnSchema, DataSetSchema, TableSchema
from app.shared.domain.data_types import FloatType, IntegerType, StringType
from app.shared.services.validation.engine import validate_constraints

_ZH_DIGITS = "零一二三四五六七八九"


def _zh(i):
    return "".join(_ZH_DIGITS[int(c)] for c in str(i))


def make_fixture(n, seed=42):
    rng = np.random.default_rng(seed)
    code_a = np.array([f"CODE-{i:07d}" for i in range(n)], dtype=object)
    code_b = np.array(["用户" + _zh(i) for i in range(n)], dtype=object)
    for i in range(0, n, 2000):
        code_a[i] = "中文混入%%d" %% i
        code_b[i] = "ASCII%%d" %% i
    df = pd.DataFrame(
        {
            "id": np.arange(n),
            "user_id": rng.integers(0, n // 10, size=n),
            "status": rng.choice(["active", "inactive", "pending"], size=n),
            "amount": rng.uniform(0, 150, size=n),
            "code_a": code_a,
            "code_b": code_b,
        }
    )
    df.loc[::503, "status"] = None
    df.loc[::1013, "amount"] = np.nan
    df.loc[::3001, "user_id"] = -1
    users = pd.DataFrame({"id": np.arange(n // 10)})
    tables = {
        "main": TableSchema(
            id="main",
            name="main",
            columns=[
                ColumnSchema(name="id", id="id", data_type=IntegerType()),
                ColumnSchema(name="user_id", id="user_id", data_type=IntegerType()),
                ColumnSchema(name="status", id="status", data_type=StringType()),
                ColumnSchema(name="amount", id="amount", data_type=FloatType()),
                ColumnSchema(name="code_a", id="code_a", data_type=StringType()),
                ColumnSchema(name="code_b", id="code_b", data_type=StringType()),
            ],
        ),
        "users": TableSchema(
            id="users",
            name="users",
            columns=[ColumnSchema(name="id", id="id", data_type=IntegerType())],
        ),
    }
    constraints = [
        NotNullConstraint(table="main", column="status"),
        RangeConstraint(table="main", column="amount", min_value=0.0, max_value=200.0),
        AllowedValuesConstraint(table="main", column="status", allowed_values={"active", "inactive", "pending"}),
        UniqueConstraint(table="main", column="id"),
        ForeignKeyConstraints(from_table="main", from_column="user_id", to_table="users", to_column="id"),
        CharsetConstraint(table="main", column="code_a", charset_mode="ascii"),
        CharsetConstraint(table="main", column="code_b", charset_mode="chinese"),
        CharsetConstraint(table="main", column="code_b", charset_mode="chinese_mixed"),
    ]
    schema = DataSetSchema(tables=tables, constraints=constraints)
    return {"main": df, "users": users}, schema


datasets, schema = make_fixture(%(rows)d)
for _ in range(1):
    validate_constraints(datasets, schema)
best = float("inf")
for _ in range(3):
    t0 = time.perf_counter()
    all_errors, details = validate_constraints(datasets, schema)
    dt = time.perf_counter() - t0
    best = min(best, dt)
print("BEST: %%.4f" %% best)
print("ERRORS: %%d" %% len(all_errors))
"""


def _run(
    cmd: list[str], cwd: str, env: dict[str, str], timeout: int = 900
) -> subprocess.CompletedProcess:
    return subprocess.run(
        cmd, capture_output=True, text=True, cwd=cwd, env=env, timeout=timeout
    )


def _backend_env() -> dict[str, str]:
    existing = os.environ.get("PYTHONPATH", "")
    return {
        **os.environ,
        "PYTHONPATH": os.pathsep.join(p for p in [BACKEND_DIR, existing] if p),
        "PRECIS_BACKEND": BACKEND_DIR,
    }


def _run_pytest(targets: list[str], env: dict[str, str]) -> subprocess.CompletedProcess:
    return _run(
        [
            sys.executable,
            "-m",
            "pytest",
            *targets,
            "-q",
            "--tb=no",
            "-p",
            "no:cacheprovider",
        ],
        cwd=BACKEND_DIR,
        env=env,
    )


def _parse_failed_tests(output: str) -> set[str]:
    failed: set[str] = set()
    for line in output.splitlines():
        line = line.strip()
        if line.startswith("FAILED"):
            name = line.split("::")[-1].split(" ", 1)[0].split("-", 1)[0].strip()
            if name:
                failed.add(name)
    return failed


def _changed_py_files() -> list[str]:
    env = {**os.environ, "GIT_OPTIONAL_LOCKS": "0"}
    tracked = _run(
        ["git", "diff", "--name-only", "--diff-filter=ACM", "--", "*.py"],
        cwd=REPO_ROOT,
        env=env,
    )
    untracked = _run(
        ["git", "ls-files", "--others", "--exclude-standard", "--", "*.py"],
        cwd=REPO_ROOT,
        env=env,
    )
    injected_base = os.path.basename(TEST_DST)
    files: list[str] = []
    for proc in (tracked, untracked):
        if proc.returncode != 0:
            continue
        for rel in proc.stdout.splitlines():
            rel = rel.strip().replace("/", os.sep)
            if not rel.startswith(f"backend{os.sep}") or rel.endswith(
                f"tests{os.sep}unit{os.sep}{injected_base}"
            ):
                continue
            files.append(os.path.join(REPO_ROOT, rel))
    return sorted(set(files))


def _tail(text: str, limit: int) -> str:
    return text[-limit:] if len(text) > limit else text


def _cleanup() -> None:
    if os.path.exists(TEST_DST):
        try:
            os.remove(TEST_DST)
        except OSError:
            pass
    cache_dir = os.path.join(BACKEND_TESTS_UNIT, "__pycache__")
    if os.path.isdir(cache_dir):
        for fname in os.listdir(cache_dir):
            if fname.startswith("test_l03_engine_equivalence"):
                try:
                    os.remove(os.path.join(cache_dir, fname))
                except OSError:
                    pass


def main() -> int:
    if not os.path.isfile(TEST_SRC) or not os.path.isdir(BACKEND_TESTS_UNIT):
        print("SCORE: 0/9")
        print("  [0/9] 环境异常：注入测试源或 backend/tests/unit 不存在")
        return 1

    scores: list[tuple[int, int, str]] = []
    env = _backend_env()
    changed = _changed_py_files()

    shutil.copy2(TEST_SRC, TEST_DST)
    try:
        # ---------- 1. 结果等价 golden 对比 ----------
        injected = _run_pytest([TEST_DST], env)
        failed = (
            _parse_failed_tests(injected.stdout)
            if injected.returncode in (0, 1)
            else set(EQUIVALENCE_TESTS)
        )
        passed = set(EQUIVALENCE_TESTS) - failed
        n_eq = len(passed)
        if not changed:
            scores.append((0, 3, "结果等价 — backend 无改动，等价性无从谈起，不计分"))
        else:
            detail = ", ".join(
                ("PASS" if t in passed else "FAIL") + ":" + t for t in EQUIVALENCE_TESTS
            )
            scores.append((n_eq, 3, f"结果等价（golden 对比）— {detail}"))
        if failed:
            print(f"--- 注入测试输出 ---\n{_tail(injected.stdout, 2000)}")
            if injected.stderr:
                print(f"--- 注入测试 stderr ---\n{_tail(injected.stderr, 800)}")

        # ---------- 2. 吞吐档 ----------
        proc = _run(
            [sys.executable, "-c", BENCH_SCRIPT % {"rows": FIXTURE_ROWS}],
            cwd=BACKEND_DIR,
            env=env,
        )
        best_s: float | None = None
        if proc.returncode == 0:
            for line in proc.stdout.splitlines():
                if line.startswith("BEST:"):
                    try:
                        best_s = float(line.split(":", 1)[1].strip())
                    except ValueError:
                        pass
        if best_s is None:
            scores.append(
                (
                    0,
                    3,
                    "吞吐档 — 基准子进程失败：\n"
                    + _tail(proc.stdout, 500)
                    + _tail(proc.stderr, 500),
                )
            )
        else:
            tier = (
                3
                if best_s <= PERF_T1_S
                else (2 if best_s <= PERF_T2_S else (1 if best_s <= PERF_T3_S else 0))
            )
            scores.append(
                (
                    tier,
                    3,
                    f"吞吐档 — best-of-3 {best_s:.3f}s（T1≤{PERF_T1_S}s 得 3，T2≤{PERF_T2_S}s 得 2，T3≤{PERF_T3_S}s 得 1）",
                )
            )

        # ---------- 3. 回归门 ----------
        regression = _run_pytest(REGRESSION_TARGETS, env)
        reg_ok = regression.returncode == 0
        scores.append(
            (
                2 if reg_ok else 0,
                2,
                "回归门（validat* 簇既有测试）— "
                + (f"{len(REGRESSION_TARGETS)} 个文件全绿" if reg_ok else "存在失败"),
            )
        )
        if not reg_ok:
            print(f"--- 回归失败输出 ---\n{_tail(regression.stdout, 2000)}")

        # ---------- 4. 质量 ruff ----------
        if not changed:
            scores.append((0, 1, "质量-ruff — 未检测到 backend 改动文件，不得分"))
        else:
            changed_rel = [os.path.relpath(f, BACKEND_DIR) for f in changed]
            ruff = _run(
                [sys.executable, "-m", "ruff", "check", *changed_rel],
                cwd=BACKEND_DIR,
                env=env,
            )
            scores.append(
                (
                    1 if ruff.returncode == 0 else 0,
                    1,
                    "质量-ruff — "
                    + (
                        "全部改动文件通过"
                        if ruff.returncode == 0
                        else "有 lint 违规：\n" + _tail(ruff.stdout, 800)
                    ),
                )
            )
    finally:
        _cleanup()

    total = sum(s for s, _, _ in scores)
    max_total = sum(m for _, m, _ in scores)
    print(f"SCORE: {total}/{max_total}")
    for i, (s, m, desc) in enumerate(scores, 1):
        print(f"  [{s}/{m}] {desc}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
