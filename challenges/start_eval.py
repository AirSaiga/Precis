"""
评测环境隔离器 — 跑测前必须先执行本脚本。

用法：
    python start_eval.py <模型名>

效果：
    1. 把磁盘上所有已存在的 eval-* worktree 归档到随机路径（跑测期间不可达）
    2. 创建当前模型的全新 worktree
    3. 物理隔离：跑测时磁盘上只有你自己的 worktree

为什么需要：
    多个模型的评测副本若同时留在磁盘上，后跑的 agent 可以读到先跑的
    实现（跨 worktree 抄袭）。本脚本用 git worktree move 归档旧副本
    （保留证据、无 junction 风险），确保跑测期间物理上只有一份。

归档位置：
    D:/Precis/.eval-archive/<原名>-<随机token>/    ← 路径含随机 token，不可预测
"""

from __future__ import annotations

import secrets
import subprocess
import sys
from pathlib import Path

BASE = Path("D:/Precis")
MAIN_REPO = BASE / "Precis"
ARCHIVE = BASE / ".eval-archive"


def run_git(args: list[str], cwd: Path = MAIN_REPO) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git"] + args, cwd=str(cwd), capture_output=True, text=True, encoding="utf-8"
    )


def main() -> int:
    if len(sys.argv) < 2:
        print("用法：python start_eval.py <模型名>")
        print("示例：python start_eval.py glm-5.2")
        return 1

    model_name = sys.argv[1].strip()
    if not model_name or "/" in model_name or "\\" in model_name or ".." in model_name:
        print(f"非法模型名：{model_name!r}")
        return 1

    my_wt = BASE / f"eval-{model_name}"

    # ── 1. 清理失效的 worktree 注册 ──
    run_git(["worktree", "prune"])

    # ── 2. 归档所有已存在的 eval-* 目录 ──
    ARCHIVE.mkdir(exist_ok=True)
    archived = 0
    for d in sorted(BASE.glob("eval-*")):
        if not d.is_dir():
            continue
        if d.resolve() == my_wt.resolve():
            continue  # 自己的旧目录也归档（重建干净的）
        token = secrets.token_hex(8)
        dest = ARCHIVE / f"{d.name}-{token}"
        # 先尝试 git worktree move（保持注册正确，不碰文件内容，无 junction 风险）
        r = run_git(["worktree", "move", str(d), str(dest)])
        if r.returncode != 0:
            # 不是 worktree（可能是普通目录）→ 直接移动
            try:
                dest.mkdir(parents=True)
                for item in d.iterdir():
                    item.rename(dest / item.name)
                d.rmdir()
            except OSError as e:
                print(f"⚠️ 归档 {d.name} 失败：{e}")
                continue
        print(f"已归档: {d.name} → .eval-archive/{dest.name}/")
        archived += 1

    # ── 3. 归档自己的旧目录（如果重跑同一模型）──
    if my_wt.exists():
        token = secrets.token_hex(8)
        dest = ARCHIVE / f"{my_wt.name}-{token}"
        r = run_git(["worktree", "move", str(my_wt), str(dest)])
        if r.returncode != 0:
            print(f"⚠️ 归档旧 {my_wt.name} 失败：{r.stderr.strip()}")
        else:
            print(f"已归档旧副本: {my_wt.name} → .eval-archive/{dest.name}/")
            archived += 1

    # ── 4. 创建全新 worktree ──
    run_git(["worktree", "prune"])  # 清理移动后的失效注册
    # --detach：detached HEAD（main 已被主仓库 checkout，评测只需改文件不需 branch）
    r = run_git(["worktree", "add", "--detach", str(my_wt), "main"])
    if r.returncode != 0:
        print(f"❌ 创建 worktree 失败：{r.stderr.strip()}")
        return 1

    # ── 5. 确认磁盘状态 ──
    remaining = [d.name for d in BASE.glob("eval-*") if d.is_dir()]
    print()
    print(f"✅ 隔离完成（归档了 {archived} 个旧副本）")
    print(f"你的 worktree：{my_wt}")
    print(f"磁盘上的 eval 目录：{remaining}（应只有你自己的）")
    print()
    print("下一步：cd 到你的 worktree，按 EVAL.md 跑题。")
    print(f"  cd {my_wt}/challenges")
    return 0


if __name__ == "__main__":
    sys.exit(main())
