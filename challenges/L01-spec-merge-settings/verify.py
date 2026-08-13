"""L01 verify — 多级评分：AI 生成配置时 settings 合并语义修复。

评分契约：
- stdout 首行 `SCORE: n/m`（n=得分，m=满分 9）
- 后续逐行 `  [i/j] 子项名：说明`
- 退出码 0 = 评分完成；仅环境异常（backend 缺失等）才非 0
- finally 清理注入的测试文件与 __pycache__

评分项：
  1. 合并语义（4 分）——注入 test_l01_settings_merge.py，4 个场景各 1 分
  2. 回归门（2 分）——config 簇既有测试相关子集全绿
  3. 质量（2 分）——改动文件 ruff + mypy 各 1 分（无改动文件则不得分）
  4. 方案合理性（1 分）——静态检查合并实现采用了 fields_set 类机制并处理 settings
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(HERE))  # 主仓库或 eval worktree 根
BACKEND_DIR = os.path.join(REPO_ROOT, "backend")
BACKEND_TESTS_UNIT = os.path.join(BACKEND_DIR, "tests", "unit")
TEST_SRC = os.path.join(HERE, "test_l01_settings_merge.py")
TEST_DST = os.path.join(BACKEND_TESTS_UNIT, "test_l01_settings_merge.py")
TARGET_FILE_REL = os.path.join(
    "app", "api", "routers", "project", "full_config_writer.py"
)

# 合并语义场景名（与注入测试中的测试函数一一对应，各 1 分）
SEMANTIC_TESTS = [
    "test_preserves_custom_settings_when_ai_omits_settings",
    "test_nested_merge_explicit_leaf_wins_rest_preserved",
    "test_ai_explicit_value_overrides_user_default",
    "test_ai_default_settings_do_not_wipe_user_customization",
]

# 回归门：config 簇既有测试相关子集（相对 BACKEND_DIR）
REGRESSION_TARGETS = [
    os.path.join("tests", "unit", "test_full_config_schema_conflict.py"),
    os.path.join("tests", "unit", "test_transform_full_config.py"),
    os.path.join("tests", "unit", "test_manifest_reader_writer.py"),
]


def _run(
    cmd: list[str], cwd: str, env: dict[str, str], timeout: int = 600
) -> subprocess.CompletedProcess:
    return subprocess.run(
        cmd, capture_output=True, text=True, cwd=cwd, env=env, timeout=timeout
    )


def _backend_env() -> dict[str, str]:
    existing = os.environ.get("PYTHONPATH", "")
    return {
        **os.environ,
        "PYTHONPATH": os.pathsep.join(p for p in [BACKEND_DIR, existing] if p),
    }


def _run_pytest(
    targets: list[str], env: dict[str, str], verbose: bool
) -> subprocess.CompletedProcess:
    return _run(
        [
            sys.executable,
            "-m",
            "pytest",
            *targets,
            "-v" if verbose else "-q",
            "--tb=no",
            "-p",
            "no:cacheprovider",
        ],
        cwd=BACKEND_DIR,
        env=env,
    )


def _parse_failed_tests(output: str) -> set[str]:
    """从 pytest 输出解析失败的测试函数名集合。"""
    failed: set[str] = set()
    for line in output.splitlines():
        line = line.strip()
        if line.startswith("FAILED"):
            # 形如 FAILED tests/unit/test_l01_settings_merge.py::test_xxx - AssertionError
            parts = line.split("::")
            if len(parts) >= 2:
                name = parts[1].split(" ", 1)[0].split("-", 1)[0].strip()
                failed.add(name)
    return failed


def _changed_py_files() -> list[str]:
    """返回 backend 下改动/新增的 .py 文件（绝对路径），排除 verify 注入的测试文件。"""
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
            if fname.startswith("test_l01_settings_merge"):
                try:
                    os.remove(os.path.join(cache_dir, fname))
                except OSError:
                    pass


def main() -> int:
    if not os.path.isfile(TEST_SRC) or not os.path.isdir(BACKEND_TESTS_UNIT):
        print("SCORE: 0/9")
        print("  [0/9] 环境异常：注入测试源或 backend/tests/unit 不存在")
        return 1

    scores: list[tuple[int, int, str]] = []  # (得分, 满分, 说明)
    env = _backend_env()

    # ---------- 1. 合并语义（注入测试，逐场景 1 分） ----------
    shutil.copy2(TEST_SRC, TEST_DST)
    try:
        injected = _run_pytest([TEST_DST], env, verbose=False)
        if injected.returncode not in (0, 1):
            # pytest 自身异常（收集错误等）——按 0 分计，不退环境异常
            passed = set()
        else:
            passed = set(SEMANTIC_TESTS) - _parse_failed_tests(injected.stdout)
        n_sem = len(passed & set(SEMANTIC_TESTS))
        detail = ", ".join(
            ("PASS" if t in passed else "FAIL") + ":" + t for t in SEMANTIC_TESTS
        )
        scores.append((n_sem, 4, f"合并语义（注入测试）— {detail}"))
        if n_sem < 4:
            print(f"--- 注入测试输出 ---\n{_tail(injected.stdout, 2000)}")
            if injected.stderr:
                print(f"--- 注入测试 stderr ---\n{_tail(injected.stderr, 800)}")

        # ---------- 2. 回归门 ----------
        regression = _run_pytest(REGRESSION_TARGETS, env, verbose=False)
        reg_ok = regression.returncode == 0
        scores.append(
            (
                2 if reg_ok else 0,
                2,
                "回归门（既有 config 簇测试）— "
                + (f"{len(REGRESSION_TARGETS)} 个文件全绿" if reg_ok else "存在失败"),
            )
        )
        if not reg_ok:
            print(f"--- 回归失败输出 ---\n{_tail(regression.stdout, 2000)}")

        # ---------- 3. 质量（ruff + mypy，仅针对改动文件） ----------
        changed = _changed_py_files()
        if not changed:
            scores.append((0, 1, "质量-ruff — 未检测到 backend 改动文件，不得分"))
            scores.append((0, 1, "质量-mypy — 未检测到 backend 改动文件，不得分"))
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
            mypy = _run(
                [sys.executable, "-m", "mypy", *changed_rel],
                cwd=BACKEND_DIR,
                env=env,
                timeout=900,
            )
            mypy_ok = mypy.returncode == 0
            scores.append(
                (
                    1 if mypy_ok else 0,
                    1,
                    "质量-mypy — "
                    + (
                        "改动文件类型检查通过"
                        if mypy_ok
                        else "类型错误：\n" + _tail(mypy.stdout, 800)
                    ),
                )
            )

        # ---------- 4. 方案合理性（静态检查） ----------
        target_path = os.path.join(BACKEND_DIR, TARGET_FILE_REL)
        rationale_ok = False
        if os.path.isfile(target_path):
            with open(target_path, encoding="utf-8") as f:
                src = f.read()
            uses_fields_set = "model_fields_set" in src or "__fields_set__" in src
            handles_settings = "settings" in src
            rationale_ok = uses_fields_set and handles_settings
        scores.append(
            (
                1 if rationale_ok else 0,
                1,
                "方案合理性 — 合并实现需使用 fields_set 类机制区分显式/默认，并处理 settings 字段",
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
