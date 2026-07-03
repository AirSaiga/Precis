"""@fileoverview apply_actions dry-run diff 计算

shadow-copy 配置目录到临时目录 → process_actions(临时目录) → unified diff。
dry-run 不触碰真实项目文件。

核心函数:
- compute_action_diff: 主入口，返回 DiffResult
- _shadow_copy: 拷贝配置目录到临时位置
- _build_file_diff: 生成单个文件的 unified diff
"""

from __future__ import annotations

import difflib
import logging
import os
import shutil
import tempfile
from dataclasses import dataclass, field
from typing import Any

from app.shared.services.llm.actions.action_processor import (
    _collect_affected_files,
    _snapshot_resource_files,
    process_actions,
)

logger = logging.getLogger(__name__)


@dataclass
class FileDiff:
    """单个文件的 diff 信息。"""

    path: str
    status: str  # modified|created|deleted
    diff: str
    before_preview: str = ""
    after_preview: str = ""


@dataclass
class DiffResult:
    """dry-run diff 计算结果。"""

    files: list[FileDiff] = field(default_factory=list)
    summary: dict[str, int] = field(default_factory=lambda: {"modified": 0, "created": 0, "deleted": 0})
    frontend_instructions: list[Any] = field(default_factory=list)
    success: bool = True
    error: str | None = None


def compute_action_diff(actions: list[dict[str, Any]], workspace_path: str) -> DiffResult:
    """计算 actions 对配置文件的预期变更(dry-run)。

    参数:
        actions: LLM 生成的 actions 列表
        workspace_path: 项目配置目录路径

    返回:
        DiffResult: 含 file diffs、summary、frontend_instructions
    """
    result = DiffResult()

    affected = _collect_affected_files(actions, workspace_path)
    workspace_abs = os.path.abspath(workspace_path)

    before_contents: dict[str, str | None] = {}
    rel_paths: list[str] = []

    for abs_p in affected:
        rel = os.path.relpath(abs_p, workspace_abs)
        rel_paths.append(rel)
        try:
            with open(abs_p, encoding="utf-8") as f:
                before_contents[rel] = f.read()
        except FileNotFoundError:
            before_contents[rel] = None
        except OSError:
            before_contents[rel] = ""

    tmp_root = tempfile.mkdtemp(prefix="precis_dryrun_")
    try:
        _shadow_copy(workspace_path, tmp_root)
        proc = process_actions(actions, tmp_root)

        if not proc.get("success"):
            result.success = False
            msgs = [r.get("message", "") for r in proc.get("results", []) if not r.get("success")]
            result.error = "; ".join(msgs) if msgs else "process_actions 失败"
            return result

        # dry-run 后用资源文件快照对比检测新建文件（比按 spec 收集可靠——
        # spec 可能不含 constraintFile，而 handler 内部派生的路径不在 _collect_affected_files 结果中）
        pre_snapshot = _snapshot_resource_files(workspace_path)
        post_snapshot = _snapshot_resource_files(tmp_root)
        created_in_tmp = post_snapshot - pre_snapshot
        for abs_p in created_in_tmp:
            rel = os.path.relpath(abs_p, tmp_root)
            if rel not in before_contents:
                rel_paths.append(rel)
                # 新建文件执行前不存在
                before_contents[rel] = None

        for rel in rel_paths:
            tmp_p = os.path.join(tmp_root, rel)
            try:
                with open(tmp_p, encoding="utf-8") as f:
                    after = f.read()
            except FileNotFoundError:
                after = None

            before = before_contents.get(rel)
            fd = _build_file_diff(rel, before, after)
            if fd is not None:  # None = 无变化，跳过（避免确认框噪音）
                result.files.append(fd)

        for fd in result.files:
            result.summary[fd.status] = result.summary.get(fd.status, 0) + 1

        for r in proc.get("results", []):
            fi = r.get("frontendInstructions")
            if fi:
                result.frontend_instructions.append(fi)

        return result
    finally:
        shutil.rmtree(tmp_root, ignore_errors=True)


def _shadow_copy(src_workspace: str, dst: str) -> None:
    """将项目配置目录浅拷贝到临时目录(跳过 .precis 和 __pycache__)。"""
    os.makedirs(dst, exist_ok=True)
    ignore = shutil.ignore_patterns(".precis", "__pycache__")
    for entry in os.listdir(src_workspace):
        if entry in (".precis", "__pycache__"):
            continue
        s = os.path.join(src_workspace, entry)
        d = os.path.join(dst, entry)
        if os.path.isdir(s):
            shutil.copytree(s, d, ignore=ignore, dirs_exist_ok=True)
        else:
            shutil.copy2(s, d)


def _build_file_diff(rel: str, before: str | None, after: str | None) -> FileDiff | None:
    """对比 before/after 生成 FileDiff。

    返回 None 表示该文件无变化（before==after），调用方应跳过，
    避免在确认框中显示"修改 → 无文本差异"误导用户。
    """
    if before is None and after is not None:
        return FileDiff(
            path=rel, status="created", diff=f"--- /dev/null\n+++ {rel}\n{after}", after_preview=after[:500]
        )

    if after is None and before is not None:
        return FileDiff(path=rel, status="deleted", diff=f"--- {rel}\n+++ /dev/null\n", before_preview=before[:500])

    # before 和 after 都存在（或都不存在）：计算真实 diff
    if before == after:
        # 内容完全一致——无变化，不生成 FileDiff（避免确认框出现"无文本差异"噪音）
        return None

    diff = "".join(
        difflib.unified_diff(
            (before or "").splitlines(keepends=True),
            (after or "").splitlines(keepends=True),
            fromfile=f"a/{rel}",
            tofile=f"b/{rel}",
        )
    )
    # diff 为空但内容不同（如仅末尾换行差异）——仍算 modified 但标注
    return FileDiff(
        path=rel,
        status="modified",
        diff=diff or "(无文本差异)",
        before_preview=(before or "")[:500],
        after_preview=(after or "")[:500],
    )
