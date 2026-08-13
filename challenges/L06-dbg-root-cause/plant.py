#!/usr/bin/env python3
"""L06 — 故障注入/确认脚本：校验管线的"提取异常静默吞掉"缺陷。

故障（真实存在）：提取派生列（Extracted 类型）时若正则编译/提取抛异常，异常只写
日志、不进入校验报告——派生列静默丢失、报告仍显示"全部通过"。这是跨模块静默数据
损坏链：Schema 配置 → 引擎阶段一 → 派生列提取 → 结果聚合 → 报告。

用法：
    python plant.py              # 注入故障（幂等）
    python plant.py --restore    # 还原被注入的文件（开发 / 调试题目用）
    python plant.py --status     # 查看当前注入状态

设计约束：
  - 只修改相对本脚本位置推导出的仓库内**那一处文件**：
    <repo>/backend/app/shared/services/validation/extractors.py
  - 锚点逐字节精确匹配（LF 规范化后）；未命中时**报错退出（非零码）**，
    绝不静默、绝不部分修改。
  - 幂等：目标文件已处于故障状态时再次运行直接成功退出（视为已注入）。
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
# challenges/L06-dbg-root-cause/plant.py → parents[1] = <repo root>
REPO_ROOT = SCRIPT_DIR.parents[1]
TARGET_REL = Path("backend/app/shared/services/validation/extractors.py")
TARGET = REPO_ROOT / TARGET_REL
BACKUP_DIR = SCRIPT_DIR / ".plant-backup"
BACKUP_FILE = BACKUP_DIR / "extractors.py"

# 故障态：提取异常只写日志、不进报告（当前 HEAD 的真实状态）。
# BUGGY_CORE 用于"fixed→buggy"的替换（替换后与 HEAD 逐字节一致）。
# BUGGY_FULL 在 BUGGY_CORE 后追加原始后续行，仅用于**状态判定**：保证"在 except 里
# 补了报错代码"的中间态（如只报 generic 信息、只包 re.compile 等修表象/半根因修改）
# 不会被子串前缀误判为故障态。
BUGGY_CORE = (
    "            except Exception as e:\n"
    "                logger.warning(\n"
    "                    f\"正则提取列 '{col_name}' 失败 (来源列: '{source_column}', 提取键: '{extract_key}'): {e}\",\n"
    "                    exc_info=True,\n"
    "                )\n"
)

BUGGY_FULL = BUGGY_CORE + ("\n        # 更新 parsed_datasets 中的 DataFrame\n")

# 修复态（供 --restore/重注入对照）：异常作为格式阶段错误进入报告并保留原始异常信息
FIXED_BLOCK = (
    "            except Exception as e:\n"
    "                logger.warning(\n"
    "                    f\"正则提取列 '{col_name}' 失败 (来源列: '{source_column}', 提取键: '{extract_key}'): {e}\",\n"
    "                    exc_info=True,\n"
    "                )\n"
    "                # 提取失败必须上报为验证错误，不得静默吞掉（否则派生列静默丢失、\n"
    '                # 报告显示"全部通过"）。错误信息保留原始异常，便于用户定位配置问题。\n'
    "                all_errors.append(\n"
    "                    {\n"
    '                        "stage": "format",\n'
    '                        "table": table_id,\n'
    '                        "column": col_name,\n'
    '                        "check_type": "ExtractedColumnValidation",\n'
    '                        "error_type": "ExtractedColumnValidationError",\n'
    '                        "message": (\n'
    "                            f\"提取列 '{col_name}' 失败：正则提取异常: {e}。\"\n"
    '                            f"请检查 Schema 中该提取列的源列与正则表达式配置。"\n'
    "                        ),\n"
    "                    }\n"
    "                )\n"
)

# 判定特征串（区分"已注入"与"已修复"）
BUGGY_SIGNATURES = ("exc_info=True",)
FIXED_SIGNATURE = "ExtractedColumnValidationError"


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


def _state(text: str) -> str:
    """判定当前注入状态：buggy / fixed / unknown。"""
    buggy = text.count(BUGGY_FULL)
    fixed = text.count(FIXED_BLOCK)
    if buggy == 1:
        return "buggy"
    if fixed == 1:
        return "fixed"
    return "unknown"


def plant() -> int:
    if not TARGET.exists():
        print(f"[plant] ERROR: 目标文件不存在: {TARGET}")
        print("[plant] 请确认本脚本位于完整仓库的 challenges/L06-dbg-root-cause/ 下。")
        return 1

    text, newline = _read_normalized()
    state = _state(text)

    if state == "buggy":
        print(
            "[plant] OK: 故障已处于注入状态（此前已注入或 HEAD 自带），无需重复操作。"
        )
        print("[plant] 请开始按 task.md 的现象描述定位并修复。")
        print("[plant] （开发调试用）还原命令: python plant.py --restore")
        return 0

    if state == "fixed":
        BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(TARGET, BACKUP_FILE)
        patched = text.replace(FIXED_BLOCK, BUGGY_CORE, 1)
        TARGET.write_bytes(_denormalize(patched, newline))
        print(f"[plant] OK: 已注入故障（提取异常静默吞掉）-> {TARGET_REL.as_posix()}")
        print("[plant] 故障已注入。请开始按 task.md 的现象描述定位并修复。")
        print("[plant] （开发调试用）还原命令: python plant.py --restore")
        return 0

    print("[plant] ERROR: 锚点未命中，无法安全注入。")
    print(f"[plant] 目标文件: {TARGET}")
    print(
        f"[plant] 锚点出现次数: buggy={text.count(BUGGY_FULL)}, fixed={text.count(FIXED_BLOCK)}"
    )
    print("[plant] 仓库版本可能已漂移，或文件被手工修改成锚点无法识别的形态。")
    print("[plant] 请核对 extractors.py 中正则提取列的 except 块，")
    print("[plant] 并更新本脚本的锚点常量后重试。")
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
        text, _ = _read_normalized()
        if _state(text) in ("buggy", "fixed"):
            print(f"[plant] OK: 已从备份还原 -> {TARGET_REL.as_posix()}")
            return 0
        print("[plant] ERROR: 备份已写回，但锚点校验未通过（备份内容可能过期）。")
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
    if _state(text) in ("buggy", "fixed"):
        print(f"[plant] OK: 已通过 git restore 还原 -> {TARGET_REL.as_posix()}")
        return 0
    print("[plant] ERROR: git restore 执行后锚点校验未通过（HEAD 版本可能已漂移）。")
    return 3


def status() -> int:
    if not TARGET.exists():
        print(f"[plant] 目标文件不存在: {TARGET}")
        return 1
    text, _ = _read_normalized()
    state = _state(text)
    label = {"buggy": "故障在位", "fixed": "已修复", "unknown": "异常（锚点未命中）"}
    print(f"[plant] 状态: 提取异常静默吞掉 = {label[state]}")
    return 0 if state != "unknown" else 2


def main() -> int:
    parser = argparse.ArgumentParser(description="L06 故障注入：提取异常静默吞掉")
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
