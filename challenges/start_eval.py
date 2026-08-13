"""
评测环境隔离器 v2 — 随机隐藏路径 + 运行锁，支持并行评测。

用法：
    python start_eval.py <模型名>

效果：
    1. 归档磁盘上旧的明路径 eval-*（不在跑的）
    2. 归档 .r/ 下过期的评测目录（无锁或锁超 8 小时的）
    3. 在 D:/Precis/.r/<随机token>/ 创建全新 worktree（隐藏父目录 + 随机路径）
    4. 写入运行锁（.running，含启动时间戳）
    5. 输出 worktree 路径 —— agent 按输出 cd 进去跑题

并行安全：
    多个模型同时跑时，各自的 worktree 在不同的随机 token 目录下，
    互不知道对方的路径（父目录 .r 默认不可见，token 随机）。
    运行锁防止后启动的 start_eval.py 归档正在跑的评测。

跑完后：
    agent 删除自己 worktree 根下的 .running 文件（EVAL.md 最后一步）。
    忘了删也没关系——锁 8 小时自动超时，下次 start_eval 会归档它。
"""

from __future__ import annotations

import secrets
import subprocess
import sys
import time
from pathlib import Path

BASE = Path("D:/Precis")
MAIN_REPO = BASE / "Precis"
RUNS_ROOT = BASE / ".r"  # 隐藏父目录（随机 token 都在这下面）
ARCHIVE = BASE / ".eval-archive"  # 归档目录
LOCK_NAME = ".running"
LOCK_TIMEOUT_SEC = 8 * 3600  # 运行锁 8 小时超时


def run_git(args: list[str], cwd: Path = MAIN_REPO) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git"] + args, cwd=str(cwd), capture_output=True, text=True, encoding="utf-8"
    )


def is_running(wt: Path) -> bool:
    """该评测目录是否正在跑（有有效运行锁）。"""
    lock = wt / LOCK_NAME
    if not lock.exists():
        return False
    try:
        ts = float(lock.read_text(encoding="utf-8").strip())
        return (time.time() - ts) < LOCK_TIMEOUT_SEC
    except (ValueError, OSError):
        return False


def archive_worktree(src: Path) -> bool:
    """把 worktree 移到归档目录（git worktree move，保留证据、不碰文件）。"""
    token = secrets.token_hex(8)
    dest = ARCHIVE / f"{src.name}-{token}"
    r = run_git(["worktree", "move", str(src), str(dest)])
    if r.returncode != 0:
        # 不是 worktree（普通目录）→ 直接移动
        try:
            dest.mkdir(parents=True)
            for item in src.iterdir():
                item.rename(dest / item.name)
            src.rmdir()
        except OSError:
            return False
    return True


def main() -> int:
    if len(sys.argv) < 2:
        print("用法：python start_eval.py <模型名>")
        print("示例：python start_eval.py glm-5.2")
        return 1

    model_name = sys.argv[1].strip()
    if not model_name or any(c in model_name for c in "/\\.."):
        print(f"非法模型名：{model_name!r}")
        return 1

    run_git(["worktree", "prune"])
    ARCHIVE.mkdir(exist_ok=True)
    RUNS_ROOT.mkdir(exist_ok=True)

    archived, skipped_running = 0, 0

    # ── 1. 归档旧的明路径 eval-*（D:/Precis/eval-xxx）──
    for d in sorted(BASE.glob("eval-*")):
        if not d.is_dir():
            continue
        if is_running(d):
            skipped_running += 1
            continue
        if archive_worktree(d):
            print(f"已归档明路径副本: {d.name}")
            archived += 1

    # ── 2. 归档 .r/ 下过期的评测目录 ──
    for d in sorted(RUNS_ROOT.iterdir()):
        if not d.is_dir() or d.name.startswith("."):
            continue
        if is_running(d):
            skipped_running += 1
            continue
        if archive_worktree(d):
            print(f"已归档过期评测: {d.name[:8]}…")
            archived += 1

    # ── 3. 创建全新 worktree（随机 token 路径）──
    run_git(["worktree", "prune"])
    token = secrets.token_hex(12)
    my_wt = RUNS_ROOT / token
    r = run_git(["worktree", "add", "--detach", str(my_wt), "main"])
    if r.returncode != 0:
        print(f"❌ 创建 worktree 失败：{r.stderr.strip()}")
        return 1

    # ── 4. 写运行锁 ──
    (my_wt / LOCK_NAME).write_text(str(time.time()), encoding="utf-8")

    # ── 5. 输出 ──
    print()
    print(f"✅ 隔离完成（归档 {archived} 个旧副本，{skipped_running} 个在跑未动）")
    print(f"你的 worktree（随机隔离路径）：{my_wt}")
    print()
    print("下一步：")
    print(f"  cd {my_wt}/challenges")
    print("  然后按 EVAL.md 跑题。")
    print(f"  跑完最后一步：rm {my_wt}/{LOCK_NAME}（删运行锁）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
