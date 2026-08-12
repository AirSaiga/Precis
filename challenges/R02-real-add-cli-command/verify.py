"""R02 verify — 在真实 Precis 仓库上验证 CLI `version` 命令全链路。

退出码：0 = PASS，非 0 = FAIL。
stdout 首行：PASS 或 FAIL，随后按 `  [✓]/[✗]` 列出明细。

流程：
  1. 把 test_cli_version.py 复制到 backend/tests/unit/cli/test_r02_version.py
  2. 以 PYTHONPATH=backend 运行 pytest 该注入文件（功能测试）
  3. 回归门：以相同 cwd/env 运行仓库既有的 CLI/Shell 相关测试子集
     （tests/unit/cli/ 全部 + 两个 CLI 集成测试；新增/注册命令时若破坏
     Command 契约、help 列表、命令解析或 Shell 启动流程，回归即失败，整体判 FAIL）
  4. 注入测试与回归子集都通过才 PASS
  5. 无论成败，finally 清理复制进去的测试文件（不污染真实仓库）
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(HERE))  # D:/Precis/Precis
BACKEND_DIR = os.path.join(REPO_ROOT, "backend")
BACKEND_TESTS_UNIT_CLI = os.path.join(BACKEND_DIR, "tests", "unit", "cli")
TEST_SRC = os.path.join(HERE, "test_cli_version.py")
TEST_DST = os.path.join(BACKEND_TESTS_UNIT_CLI, "test_r02_version.py")

# 回归门：仓库既有的 CLI/Shell 相关测试子集（相对 BACKEND_DIR）。
# 覆盖命令解析/上下文、help 命令、AI 命令、validate 抑制、以及 CLI 冒烟/回归集成测试。
REGRESSION_TARGETS = [
    os.path.join("tests", "unit", "cli"),
    os.path.join("tests", "integration", "test_cli_smoke.py"),
    os.path.join("tests", "integration", "test_cli_regression.py"),
]


def _run_pytest(
    targets: list[str],
    env: dict[str, str],
    verbose: bool,
    ignore: list[str] | None = None,
) -> subprocess.CompletedProcess:
    """以统一的 cwd/env 运行 pytest（-p no:cacheprovider 保证不产生 .pytest_cache）。"""
    ignore_args = [f"--ignore={path}" for path in (ignore or [])]
    return subprocess.run(
        [
            sys.executable,
            "-m",
            "pytest",
            *targets,
            *ignore_args,
            "-v" if verbose else "-q",
            "--tb=short",
            "-p",
            "no:cacheprovider",
        ],
        capture_output=True,
        text=True,
        cwd=BACKEND_DIR,
        env=env,
    )


def _tail(text: str, limit: int) -> str:
    return text[-limit:] if len(text) > limit else text


def main() -> int:
    if not os.path.isfile(TEST_SRC):
        print("FAIL")
        print(f"  测试源文件不存在: {TEST_SRC}")
        return 1
    if not os.path.isdir(BACKEND_TESTS_UNIT_CLI):
        print("FAIL")
        print(f"  后端测试目录不存在: {BACKEND_TESTS_UNIT_CLI}")
        return 1

    # 1. 复制测试文件进真实仓库（verify 期间临时存在）
    shutil.copy2(TEST_SRC, TEST_DST)
    try:
        # 前置而非覆盖：保留调用方已有的 PYTHONPATH 条目（过滤空串）
        existing_pythonpath = os.environ.get("PYTHONPATH", "")
        env = {
            **os.environ,
            "PYTHONPATH": os.pathsep.join(
                p for p in [BACKEND_DIR, existing_pythonpath] if p
            ),
        }

        # 2. 注入测试（PYTHONPATH=backend 使 `from app.cli...` 可解析）
        injected = _run_pytest([TEST_DST], env, verbose=True)
        injected_ok = injected.returncode == 0

        # 3. 回归门：既有 CLI/Shell 测试子集（与注入测试同一 cwd/env，只读运行）。
        # 注入文件位于 tests/unit/cli/ 目录内，回归收集该目录时必须 --ignore 排除，
        # 否则未实现功能时注入测试的失败会被误算进回归门（误报）。
        regression = _run_pytest(
            REGRESSION_TARGETS,
            env,
            verbose=False,
            # 归一化为正斜杠：os.path.relpath 在 Windows 产生反斜杠，
            # 与 pytest 跨平台收集到的路径表示可能有差异
            ignore=[os.path.relpath(TEST_DST, BACKEND_DIR).replace(os.sep, "/")],
        )
        regression_ok = regression.returncode == 0

        passed = injected_ok and regression_ok

        # 4. 按标准契约输出：首行 PASS/FAIL，随后 [✓]/[✗] 明细
        print("PASS" if passed else "FAIL")
        print(
            f"  [{'✓' if injected_ok else '✗'}] 注入测试: "
            f"{os.path.relpath(TEST_DST, BACKEND_DIR)}"
        )
        print(
            f"  [{'✓' if regression_ok else '✗'}] 回归（既有测试）: "
            + ", ".join(REGRESSION_TARGETS)
        )

        print("--- 注入测试输出 ---")
        print(_tail(injected.stdout, 2500))
        if injected.stderr:
            print("--- 注入测试 stderr ---")
            print(_tail(injected.stderr, 800))

        if not regression_ok:
            # 回归失败单独列出输出，便于定位被哪条既有测试挡住
            print("--- 回归失败输出 ---")
            print(_tail(regression.stdout, 2500))
            if regression.stderr:
                print("--- 回归 stderr ---")
                print(_tail(regression.stderr, 800))

        return 0 if passed else 1
    finally:
        # 5. 清理：移除临时测试文件 + 清理 __pycache__，保持真实仓库干净
        if os.path.exists(TEST_DST):
            try:
                os.remove(TEST_DST)
            except OSError:
                pass
        # 移除 pytest 缓存的 .pyc（test_r02_version 的字节码）
        cache_dir = os.path.join(BACKEND_TESTS_UNIT_CLI, "__pycache__")
        if os.path.isdir(cache_dir):
            for fname in os.listdir(cache_dir):
                if fname.startswith("test_r02_version"):
                    try:
                        os.remove(os.path.join(cache_dir, fname))
                    except OSError:
                        pass
        # 注：两次 pytest 运行均带 -p no:cacheprovider，不会创建/更新 .pytest_cache；
        # 既有测试文件的 __pycache__ 属仓库常态产物（已被 .gitignore 覆盖），无需清理。


if __name__ == "__main__":
    sys.exit(main())
