"""
@fileoverview 核心模块版本标识导出

功能概述:
- 导出版本标识相关符号（Edition、个人版/团队版判断等）
- 为上层模块提供统一的版本能力入口

架构设计:
- 聚合导出: 从 edition 子模块重新导出核心标识
- 延迟加载: 由调用方按需导入具体功能

输入示例:
    from app.shared.core import get_current_edition, is_team_edition

输出示例:
    edition = get_current_edition()  # Edition.PERSONAL / Edition.TEAM
"""

from .edition import (
    Edition,
    clear_edition_cache,
    get_current_edition,
    is_personal_edition,
    is_team_edition,
    set_edition_for_test,
)

__all__ = [
    "Edition",
    "get_current_edition",
    "is_team_edition",
    "is_personal_edition",
    "clear_edition_cache",
    "set_edition_for_test",
]
