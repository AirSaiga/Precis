"""
@fileoverview 预览服务统一入口

功能概述:
- 聚合导出数据预览相关的路径校验与工具函数
- 提供文件路径安全校验和允许目录管理能力

架构设计:
- 门面模式: 隐藏 path 子模块实现细节
- 统一导出: validate_file_path、get_allowed_directories 等核心工具直接暴露
"""

from .path import (
    get_allowed_directories,
    is_path_in_allowed_directories,
    load_allowed_paths_from_config,
    validate_file_path,
)

# 对外暴露的公共接口列表，限定 from xxx import * 时的可见范围
__all__ = [
    "validate_file_path",
    "get_allowed_directories",
    "load_allowed_paths_from_config",
    "is_path_in_allowed_directories",
]
