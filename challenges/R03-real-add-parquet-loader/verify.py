"""R03 verify — 在真实 Precis 仓库上验证 Parquet 数据源全链路。

退出码：0 = PASS，非 0 = FAIL。
stdout 首行：PASS 或 FAIL，随后按 `  [✓]/[✗]` 列出明细。

流程：
  1. 把 test_parquet_loader.py 复制到 backend/tests/unit/test_r03_parquet_loader.py
  2. 以 PYTHONPATH=backend 运行 pytest 该注入文件（功能测试）
  3. 回归门：以相同 cwd/env 运行仓库既有的 loader/spec 相关测试子集
     （specs/loaders 包的 __init__ 延迟导入、双注册表、加载器基类与既有加载器行为；
     新增数据源时若破坏 __getattr__ 分支、注册表或基类契约，回归即失败，整体判 FAIL）
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
BACKEND_TESTS_UNIT = os.path.join(BACKEND_DIR, "tests", "unit")
TEST_SRC = os.path.join(HERE, "test_parquet_loader.py")
TEST_DST = os.path.join(BACKEND_TESTS_UNIT, "test_r03_parquet_loader.py")

# 回归门：仓库既有的 loader/spec 相关测试子集（相对 BACKEND_DIR）。
# 覆盖：规格模型与注册表、loaders 包 __init__ 注册表与辅助函数、加载器基类、
# loaders/specs 延迟导入边界、既有 CSV/Excel 加载器行为。
REGRESSION_TARGETS = [
    os.path.join("tests", "unit", "test_data_source_specs.py"),
    os.path.join("tests", "unit", "test_data_source_loaders_init.py"),
    os.path.join("tests", "unit", "test_loaders_registry.py"),
    os.path.join("tests", "unit", "test_loaders_init_edge.py"),
    os.path.join("tests", "unit", "test_loaders_base.py"),
    os.path.join("tests", "unit", "test_csv_excel_loaders.py"),
]


def _run_pytest(
    targets: list[str], env: dict[str, str], verbose: bool
) -> subprocess.CompletedProcess:
    """以统一的 cwd/env 运行 pytest（-p no:cacheprovider 保证不产生 .pytest_cache）。"""
    return subprocess.run(
        [
            sys.executable,
            "-m",
            "pytest",
            *targets,
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
    if not os.path.isdir(BACKEND_TESTS_UNIT):
        print("FAIL")
        print(f"  后端测试目录不存在: {BACKEND_TESTS_UNIT}")
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

        # 2. 注入测试（PYTHONPATH=backend 使 `from app.shared...` 可解析）
        injected = _run_pytest([TEST_DST], env, verbose=True)
        injected_ok = injected.returncode == 0

        # 3. 回归门：既有 loader/spec 测试子集（与注入测试同一 cwd/env，只读运行）
        regression = _run_pytest(REGRESSION_TARGETS, env, verbose=False)
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
        # 移除 pytest 缓存的 .pyc（test_r03_parquet_loader 的字节码）
        cache_dir = os.path.join(BACKEND_TESTS_UNIT, "__pycache__")
        if os.path.isdir(cache_dir):
            for fname in os.listdir(cache_dir):
                if fname.startswith("test_r03_parquet_loader"):
                    try:
                        os.remove(os.path.join(cache_dir, fname))
                    except OSError:
                        pass
        # 注：两次 pytest 运行均带 -p no:cacheprovider，不会创建/更新 .pytest_cache；
        # 既有测试文件的 __pycache__ 属仓库常态产物（已被 .gitignore 覆盖），无需清理。


if __name__ == "__main__":
    sys.exit(main())
