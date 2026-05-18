"""
@fileoverview Schema 版本管理模块包入口

职责:
- 管理配置格式版本
- 提供版本检查工具

架构设计:
- version.py: 版本常量定义
- types.py: 配置类型定义

输入示例:
    from app.shared.core.schemas import CURRENT_VERSION, is_supported_version
    if is_supported_version(2):
        print("当前版本受支持")

输出示例:
    CURRENT_VERSION -> 2
    is_supported_version(2) -> True
"""

from .version import (
    CURRENT_VERSION,
    MAX_SUPPORTED_VERSION,
    MIN_SUPPORTED_VERSION,
    get_version_info,
    is_supported_version,
)

__all__ = [
    # 版本相关
    "CURRENT_VERSION",
    "MIN_SUPPORTED_VERSION",
    "MAX_SUPPORTED_VERSION",
    "is_supported_version",
    "get_version_info",
]
