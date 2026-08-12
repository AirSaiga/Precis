#!/usr/bin/env python3
"""X02 — 故障注入脚本：删除键盘监听器中的 IME 组合输入守卫。

用法：
    python plant.py              # 注入故障（幂等）
    python plant.py --restore    # 还原被注入的文件（开发 / 调试题目用）
    python plant.py --status     # 查看当前注入状态

设计约束：
  - 只修改相对本脚本位置推导出的仓库内**那一处文件**：
    <repo>/frontend/src/features/keyboard/listeners/keyboardListener.ts
  - 锚点精确匹配：守卫代码块必须逐字节命中且唯一，否则报错退出（非零码），
    绝不静默、绝不部分修改。
  - 幂等：守卫已不存在时再次运行直接成功退出（视为已注入）。
  - 备份（供 --restore）放在本脚本旁的 .plant-backup/ 下，不碰仓库其它文件；
    无备份时 --restore 回退到 `git restore`（worktree 场景）。

⚠️ 请在评测副本 / git worktree 中运行，**绝不要**在主仓库 D:/Precis/Precis 运行。
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
# challenges/X02-dbg-planted-ime/plant.py → parents[0]=challenges → parents[1]=<repo root>
REPO_ROOT = SCRIPT_DIR.parents[1]
TARGET_REL = Path("frontend/src/features/keyboard/listeners/keyboardListener.ts")
TARGET = REPO_ROOT / TARGET_REL
BACKUP_DIR = SCRIPT_DIR / ".plant-backup"
BACKUP_FILE = BACKUP_DIR / "keyboardListener.ts"

# 锚点：IME 组合输入守卫完整代码块（5 行注释 + if 语句 + 块后空行）。
# 与 keyboardListener.ts 中 handleKeydown() 内的原始文本逐字节一致（LF 规范化后）。
GUARD_BLOCK = (
    "    // IME 组合输入守卫：拼音/日文/韩文等 IME 选词过程中派发的 keydown（尤其\n"
    "    // Backspace/Enter/单字符键）不得触发任何快捷键，否则会误删节点、误发消息。\n"
    "    // isComposing（标准）为主，keyCode===229 为旧版 Chromium 兼容兜底。\n"
    "    // 注意：isIgnoredElement 只覆盖 input/textarea/contenteditable 聚焦场景，\n"
    "    // 焦点在画布等非输入元素但 IME 仍处合成态时只能靠本守卫拦截，两者缺一不可。\n"
    "    if (event.isComposing || event.keyCode === 229) {\n"
    "      return\n"
    "    }\n"
    "\n"
)

# 守卫删除后必然消失的特征串（用于幂等判定：区分"已注入"与"锚点未命中"）
GUARD_SIGNATURES = ("event.isComposing", "keyCode === 229")


def _read_normalized() -> tuple[str, str]:
    """读目标文件并规范化换行为 LF；返回 (规范化文本, 原换行符)。"""
    raw = TARGET.read_bytes()
    text = raw.decode("utf-8")
    newline = "\r\n" if "\r\n" in text else "\n"
    return text.replace("\r\n", "\n"), newline


def _denormalize(text: str, newline: str) -> bytes:
    """按原换行符还原并编码为字节。"""
    if newline == "\r\n":
        text = text.replace("\n", "\r\n")
    return text.encode("utf-8")


def _guard_present(text: str) -> bool:
    return any(sig in text for sig in GUARD_SIGNATURES)


def plant() -> int:
    if not TARGET.exists():
        print(f"[plant] ERROR: 目标文件不存在: {TARGET}")
        print("[plant] 请确认本脚本位于完整仓库的 challenges/X02-dbg-planted-ime/ 下。")
        return 1

    text, newline = _read_normalized()
    count = text.count(GUARD_BLOCK)

    if count == 1:
        # 备份原始字节（--restore 首选路径）
        BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(TARGET, BACKUP_FILE)

        patched = text.replace(GUARD_BLOCK, "", 1)
        TARGET.write_bytes(_denormalize(patched, newline))
        print(f"[plant] OK: 已删除 IME 组合输入守卫 -> {TARGET_REL.as_posix()}")
        print("[plant] 故障已注入。请开始按 task.md 的现象描述定位并修复。")
        print("[plant] （开发调试用）还原命令: python plant.py --restore")
        return 0

    if count == 0 and not _guard_present(text):
        # 锚点不在，且守卫特征串也不存在 → 已注入过，幂等成功
        print("[plant] OK: 守卫已不存在（故障此前已注入），无需重复操作。")
        return 0

    # 锚点未命中但守卫特征仍在 → 文件与预期版本不一致，报错退出而非静默乱改
    print("[plant] ERROR: 锚点未命中，无法安全注入。")
    print(f"[plant] 目标文件: {TARGET}")
    print(f"[plant] 锚点出现次数: {count}（期望恰好 1 次）")
    if _guard_present(text):
        print("[plant] 检测到守卫特征串仍存在，但代码块文本与锚点不一致——")
        print(
            "[plant] 仓库版本可能已漂移。请核对 keyboardListener.ts 中 handleKeydown() 的"
        )
        print("[plant] IME 守卫代码块，并更新本脚本的 GUARD_BLOCK 锚点后重试。")
    return 2


def restore() -> int:
    if not TARGET.exists():
        print(f"[plant] ERROR: 目标文件不存在: {TARGET}")
        return 1

    if BACKUP_FILE.exists():
        shutil.copyfile(BACKUP_FILE, TARGET)
        BACKUP_FILE.unlink()
        try:
            BACKUP_DIR.rmdir()  # 仅在空目录时成功
        except OSError:
            pass
        # 校验守卫块确已还原
        text, _ = _read_normalized()
        if text.count(GUARD_BLOCK) == 1:
            print(f"[plant] OK: 已从备份还原 -> {TARGET_REL.as_posix()}")
            return 0
        print("[plant] ERROR: 备份已写回，但守卫锚点校验未通过（备份内容可能过期）。")
        return 3

    # 无本地备份 → 回退 git restore（worktree / 普通 clone 均可用）
    try:
        subprocess.run(
            ["git", "-C", str(REPO_ROOT), "rev-parse", "--is-inside-work-tree"],
            check=True,
            capture_output=True,
            text=True,
        )
        subprocess.run(
            [
                "git",
                "-C",
                str(REPO_ROOT),
                "restore",
                "--source=HEAD",
                "--worktree",
                "--",
                TARGET_REL.as_posix(),
            ],
            check=True,
            capture_output=True,
            text=True,
        )
    except (subprocess.CalledProcessError, FileNotFoundError) as exc:
        print(f"[plant] ERROR: 无本地备份且 git restore 失败: {exc}")
        print("[plant] 无法还原，请手动恢复该文件。")
        return 3

    text, _ = _read_normalized()
    if text.count(GUARD_BLOCK) == 1:
        print(f"[plant] OK: 已通过 git restore 还原 -> {TARGET_REL.as_posix()}")
        return 0
    print(
        "[plant] ERROR: git restore 执行后守卫锚点校验未通过（HEAD 版本可能不含守卫）。"
    )
    return 3


def status() -> int:
    if not TARGET.exists():
        print(f"[plant] 目标文件不存在: {TARGET}")
        return 1
    text, _ = _read_normalized()
    count = text.count(GUARD_BLOCK)
    if count == 1:
        print("[plant] 状态: 原始（守卫在位，未注入）")
    elif count == 0 and not _guard_present(text):
        print("[plant] 状态: 已注入（守卫已删除）")
    else:
        print("[plant] 状态: 异常（锚点计数与特征串不一致，文件可能已被手工修改）")
        return 2
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="X02 故障注入：删除 IME 组合输入守卫")
    parser.add_argument("--restore", action="store_true", help="还原被注入的文件")
    parser.add_argument("--status", action="store_true", help="查看注入状态")
    args = parser.parse_args()

    print(f"[plant] 仓库根: {REPO_ROOT}")
    print("[plant] 提醒: 请确认你在评测副本 / worktree 中运行，绝不要在主仓库运行。")

    if args.restore:
        return restore()
    if args.status:
        return status()
    return plant()


if __name__ == "__main__":
    sys.exit(main())
