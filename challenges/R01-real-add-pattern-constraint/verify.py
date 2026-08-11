"""R01 verify — 在真实 Precis 仓库上验证 Pattern 约束全链路。

退出码：0 = PASS，非 0 = FAIL。
stdout 首行：PASS 或 FAIL。

流程：
  1. 把 test_pattern.py 复制到 backend/tests/unit/test_r01_pattern.py
  2. 以 PYTHONPATH=backend 运行 pytest 该文件
  3. 捕获输出，按退出码判定
  4. 无论成败，finally 清理复制进去的测试文件（不污染真实仓库）
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
TEST_SRC = os.path.join(HERE, "test_pattern.py")
TEST_DST = os.path.join(BACKEND_TESTS_UNIT, "test_r01_pattern.py")


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
        # 2. 运行 pytest（PYTHONPATH=backend 使 `from app.shared...` 可解析）
        env = {**os.environ, "PYTHONPATH": BACKEND_DIR}
        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "pytest",
                TEST_DST,
                "-v",
                "--tb=short",
                "-p",
                "no:cacheprovider",
            ],
            capture_output=True,
            text=True,
            cwd=BACKEND_DIR,
            env=env,
        )
        passed = result.returncode == 0

        # 3. 按标准契约输出
        print("PASS" if passed else "FAIL")
        tail = result.stdout[-2500:] if len(result.stdout) > 2500 else result.stdout
        print(tail)
        if result.stderr:
            print("--- stderr ---")
            print(result.stderr[-800:])
        return 0 if passed else 1
    finally:
        # 4. 清理：移除临时测试文件，保持真实仓库干净
        if os.path.exists(TEST_DST):
            try:
                os.remove(TEST_DST)
            except OSError:
                pass


if __name__ == "__main__":
    sys.exit(main())
