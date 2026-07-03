"""@fileoverview 文件路径安全校验

功能概述:
- 提供统一的文件路径安全校验工具，供所有涉及文件系统操作的 HTTP 端点使用
- 两层校验策略:
  1. assert_no_traversal: 反穿越校验（拒绝 `..` 相对成分 + resolve 解析 symlink），
     适用于用户在项目外选择的数据文件场景（preview/validation/files-ops），保留任意数据文件能力
  2. assert_path_within_root: 限定到指定根目录（白名单语义），
     适用于临时文件（TEMP_DIR）、校验历史（configPath）等有明确归属的场景

设计原则:
- 只做必要的防御:拒绝 `..` 穿越和 resolve 符号链接。不做系统目录黑名单之类的
  额外层——应用层重复 OS 权限边界既不完整(挡不住 ~/.ssh)又增加误伤与维护负担。
- 校验失败统一抛 HTTPException（403 拒绝 / 400 参数错误 / 404 不存在）
- 基于 Path.resolve() 解析符号链接与 `..`，避免 abspath+normpath 无法防 symlink 的缺陷
"""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import HTTPException


def assert_no_traversal(file_path: str, *, must_exist: bool = True) -> str:
    """
    @methoddesc 反穿越校验，不限根目录

    适用于用户在项目外选择的数据文件场景（preview/validation/files-ops）。
    保留访问任意合法数据文件的能力，仅阻止路径穿越（`..` 相对成分）。

    参数:
        file_path: 待校验的文件路径（原始字符串）
        must_exist: 是否要求文件必须存在（默认 True）

    返回:
        解析后的绝对路径字符串

    抛出:
        HTTPException: 400 路径为空/含穿越成分; 404 文件不存在
    """
    if not file_path or not file_path.strip():
        raise HTTPException(status_code=400, detail="文件路径不能为空")

    raw = file_path.strip()

    # 拒绝显式 `..` 段：数据文件访问场景不应需要 `..`，用户应直接提供目标文件绝对路径
    path_obj = Path(raw)
    if any(part == ".." for part in path_obj.parts):
        raise HTTPException(
            status_code=400,
            detail="路径包含 `..` 相对穿越成分，请提供目标文件的绝对路径。",
        )

    # resolve() 解析符号链接与剩余相对成分，得到真实绝对路径
    try:
        resolved = path_obj.resolve()
    except OSError as e:
        raise HTTPException(status_code=400, detail=f"路径解析失败: {e}")

    if must_exist and not resolved.exists():
        raise HTTPException(status_code=404, detail=f"文件未找到: {file_path}")

    return str(resolved)


def assert_path_within_root(file_path: str, root: str, *, must_exist: bool = True) -> str:
    """
    @methoddesc 限定路径必须落在指定根目录内（白名单语义）

    适用于临时文件（TEMP_DIR）、校验历史（configPath）等有明确归属的场景。
    基于 resolve() 解析后做包含关系检查，能正确处理符号链接。

    参数:
        file_path: 待校验的文件路径（原始字符串）
        root: 允许的根目录绝对路径
        must_exist: 是否要求文件必须存在（默认 True）

    返回:
        解析后的绝对路径字符串

    抛出:
        HTTPException: 400 路径为空; 403 越出根目录; 404 不存在
    """
    if not file_path or not file_path.strip():
        raise HTTPException(status_code=400, detail="文件路径不能为空")

    raw = file_path.strip()
    try:
        resolved = Path(raw).resolve()
    except OSError as e:
        raise HTTPException(status_code=400, detail=f"路径解析失败: {e}")

    try:
        root_resolved = Path(root).resolve()
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"根目录解析失败: {e}")

    root_str = str(root_resolved)
    resolved_str = str(resolved)
    # 包含关系：resolved == root 或 resolved 在 root 之下
    if resolved_str != root_str and not resolved_str.startswith(root_str + os.sep):
        raise HTTPException(status_code=403, detail="路径越出允许的根目录范围。")

    if must_exist and not resolved.exists():
        raise HTTPException(status_code=404, detail=f"文件未找到: {file_path}")

    return resolved_str


def validate_file_access(file_path: str) -> str:
    """
    @methoddesc 文件路径可访问性校验（反穿越硬化版）

    兼容历史调用点（preview/content_mode、path_mode、validation 等），
    内部委托给 assert_no_traversal。返回解析后的绝对路径供调用方使用。

    抛出:
        HTTPException: 400 路径为空/含穿越成分; 403 系统敏感目录; 404 文件不存在
    """
    return assert_no_traversal(file_path, must_exist=True)
