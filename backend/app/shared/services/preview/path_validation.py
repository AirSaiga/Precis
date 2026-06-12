"""@fileoverview 文件路径基本校验

功能概述:
- 校验文件路径非空且文件存在
- 替代原有的白名单三步校验（已移除）
"""

from __future__ import annotations

import os

from fastapi import HTTPException


def validate_file_access(file_path: str) -> None:
    """
    @methoddesc 校验文件路径可访问性

    仅检查路径非空和文件存在性。不包含白名单/权限逻辑。

    抛出:
        HTTPException: 400 路径为空, 404 文件不存在
    """
    if not file_path or not file_path.strip():
        raise HTTPException(status_code=400, detail="文件路径不能为空")

    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail=f"文件未找到: {file_path}")
