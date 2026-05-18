# backend/app/cli/shell/commands/ai/diff.py
"""
@fileoverview AI 配置变更 Diff 生成模块

功能概述:
- 使用 Python 标准库 difflib 生成统一差异格式（Unified Diff）
- 对比文件修改前后的内容，输出类 Git diff 格式
- 处理行尾换行符，确保 diff 格式标准

架构设计:
- 独立工具模块，无外部依赖（仅使用标准库 difflib）
- 被 display.py 调用以展示详细的文件变更对比
- 统一差异格式（unified diff）是 Git 等版本控制工具使用的标准格式

输入示例:
    _generate_diff("constraints.yaml", old_content, new_content)

输出示例:
    "--- a/constraints.yaml\n+++ b/constraints.yaml\n@@ -1,3 +1,4 @@..."
"""

from __future__ import annotations

import difflib
from pathlib import Path


def _generate_diff(file_path: str, old_content: str, new_content: str) -> str:
    """生成文件的 diff 显示。

    使用 Python 标准库 difflib.unified_diff 生成统一差异格式（Unified Diff），
    这是 Git 等版本控制工具使用的标准格式。

    Args:
        file_path: 文件路径（用于显示文件名）
        old_content: 修改前的文件内容
        new_content: 修改后的文件内容

    Returns:
        统一差异格式的字符串
    """
    from_line = old_content.splitlines(keepends=True) if old_content else []
    to_line = new_content.splitlines(keepends=True) if new_content else []

    # 确保最后一行以换行符结尾，否则 diff 格式不标准
    if from_line and not from_line[-1].endswith("\n"):
        from_line[-1] += "\n"
    if to_line and not to_line[-1].endswith("\n"):
        to_line[-1] += "\n"

    diff = difflib.unified_diff(
        from_line, to_line, fromfile=f"a/{Path(file_path).name}", tofile=f"b/{Path(file_path).name}", lineterm="\n"
    )

    return "".join(diff)
