"""L06 verify — 校验管线"提取异常静默吞掉"修复的多级评分。

退出码：0 = 评分完成（仅环境异常才非 0）。
stdout 首行：SCORE: n/m，随后逐行 `  [i/j] 子项名：说明`。

评分项（总分 9）：
  - 根因（0-4）：R1 非法正则 → 上报且含原始异常内容（3 分）；
    R2 上报且不中断其余表校验（1 分）。
  - 完整性（0-2）：E1 好/坏提取列共存（1 分）；E2 重复列名真实触发路径（1 分）。
  - 回归门（0-2）：校验引擎/执行器/服务行为 4 个既有测试文件全绿。
  - 质量门（0-1）：ruff check backend/app 0 问题。

清理：注入测试文件在 finally 中删除，不污染真实仓库。
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[1]
BACKEND_DIR = REPO_ROOT / "backend"
TEST_SRC = SCRIPT_DIR / "test_l06_extraction_silent_loss.py"
TEST_DST = BACKEND_DIR / "tests" / "unit" / "test_l06_extraction_silent_loss.py"

# 隐藏用例 → (分值, pytest -k 选择器)
ITEMS = [
    ("根因-1: 非法正则上报且含原始异常内容", 3, "test_l06_r1"),
    ("根因-2: 上报且不中断其余表校验", 1, "test_l06_r2"),
    ("完整性-1: 好/坏提取列共存", 1, "test_l06_e1"),
    ("完整性-2: 重复列名真实触发路径上报", 1, "test_l06_e2"),
]

REGRESSION_FILES = [
    "tests/unit/test_validation_engine_behavior.py",
    "tests/unit/test_validation_executor_behavior.py",
    "tests/unit/test_validation_service_behavior.py",
    "tests/unit/test_validation_executor_options.py",
]


def _run(cmd: list[str], timeout: int = 300) -> tuple[int, str, str]:
    """运行子进程，返回 (退出码, stdout, stderr)。"""
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(BACKEND_DIR),
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return proc.returncode, proc.stdout, proc.stderr
    except subprocess.TimeoutExpired as exc:
        out = (
            exc.stdout.decode("utf-8", "replace")
            if isinstance(exc.stdout, bytes)
            else (exc.stdout or "")
        )
        err = (
            exc.stderr.decode("utf-8", "replace")
            if isinstance(exc.stderr, bytes)
            else (exc.stderr or "")
        )
        return -1, out, err + "\n[子进程超时被杀]"
    except FileNotFoundError as exc:
        return -1, "", str(exc)


# ---------- 前置检查（不注入文件，直接非 0 退出） ----------
def precheck() -> int:
    problems = []
    if not TEST_SRC.exists():
        problems.append(f"注入测试源文件不存在: {TEST_SRC}")
    if not BACKEND_DIR.exists():
        problems.append(f"后端目录不存在: {BACKEND_DIR}")
    code, out, err = _run([sys.executable, "-m", "pytest", "--version"], timeout=60)
    if code != 0:
        problems.append(f"pytest 不可用: {out.strip()} {err.strip()}")
    code, out, err = _run([sys.executable, "-m", "ruff", "--version"], timeout=60)
    if code != 0:
        problems.append(f"ruff 不可用: {out.strip()} {err.strip()}")
    if problems:
        print("SCORE: 0/9")
        for p in problems:
            print(f"  [✗] 前置检查: {p}")
        print("请确认在完整仓库副本（含 backend 环境）中运行。")
        return 1
    return 0


def main() -> int:
    if precheck() != 0:
        return 1

    injected = False
    item_results: list[tuple[str, int, bool, str]] = []
    reg_ok = False
    reg_out = ""
    ruff_ok = False
    ruff_out = ""

    try:
        TEST_DST.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(TEST_SRC, TEST_DST)
        injected = True

        for label, points, selector in ITEMS:
            code, out, err = _run(
                [
                    sys.executable,
                    "-m",
                    "pytest",
                    "tests/unit/test_l06_extraction_silent_loss.py",
                    "-k",
                    selector,
                    "-q",
                    "--no-header",
                ]
            )
            ok = code == 0
            item_results.append((label, points, ok, (out + err)[-2000:]))
    finally:
        if injected and TEST_DST.exists():
            try:
                TEST_DST.unlink()
            except OSError:
                pass

    # 回归门
    reg_code, reg_stdout, reg_stderr = _run(
        [sys.executable, "-m", "pytest", *REGRESSION_FILES, "-q", "--no-header"]
    )
    reg_ok = reg_code == 0
    reg_out = (reg_stdout + reg_stderr)[-2000:]

    # 质量门：ruff check app
    ruff_code, ruff_stdout, ruff_stderr = _run(
        [sys.executable, "-m", "ruff", "check", "app", "--output-format=concise"]
    )
    ruff_ok = ruff_code == 0
    ruff_out = (ruff_stdout + ruff_stderr)[-1500:]

    # ---------- 汇总 ----------
    score = 0
    total = 9
    lines: list[tuple[int, int, str]] = []
    for label, points, ok, _ in item_results:
        score += points if ok else 0
        lines.append(
            (points if ok else 0, points, f"{label}{'：通过' if ok else '：未通过'}")
        )
    score += 2 if reg_ok else 0
    lines.append(
        (
            2 if reg_ok else 0,
            2,
            f"回归门: 引擎/执行器/服务 4 个既有测试文件{'全绿' if reg_ok else '有失败'}",
        )
    )
    score += 1 if ruff_ok else 0
    lines.append(
        (
            1 if ruff_ok else 0,
            1,
            f"质量门: ruff check backend/app {'0 问题' if ruff_ok else '有问题'}",
        )
    )

    print(f"SCORE: {score}/{total}")
    for got, possible, label in lines:
        print(f"  [{got}/{possible}] {label}")

    failed_items = [r for r in item_results if not r[2]]
    if failed_items:
        print("--- 隐藏测试失败输出（尾部） ---")
        for label, _, _, out in failed_items:
            print(f"### {label}")
            print(out[-1200:])
    if not reg_ok:
        print("--- 回归门输出（尾部） ---")
        print(reg_out)
    if not ruff_ok:
        print("--- ruff 输出（尾部） ---")
        print(ruff_out)
    if injected:
        print("  [✓] 清理: 注入测试文件已移除")
    return 0


if __name__ == "__main__":
    sys.exit(main())
