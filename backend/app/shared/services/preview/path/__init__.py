"""@fileoverview 数据预览路径处理包入口

功能概述:
- 统一导出路径验证、白名单管理和权限检查接口
- 为数据预览功能提供安全的路径访问控制
"""

from app.shared.services.preview.path.permission import (
    check_path_permission,
    is_path_writable,
)
from app.shared.services.preview.path.types import PathPolicy, WhitelistEntry
from app.shared.services.preview.path.validator import validate_file_access, validate_file_path
from app.shared.services.preview.path.whitelist import (
    get_allowed_directories,
    is_path_in_allowed_directories,
    load_allowed_paths_from_config,
    load_whitelist_config,
)

# 对外暴露的公共接口列表，限定 from xxx import * 时的可见范围
__all__ = [
    "PathPolicy",
    "WhitelistEntry",
    "validate_file_access",
    "validate_file_path",
    "get_allowed_directories",
    "load_allowed_paths_from_config",
    "is_path_in_allowed_directories",
    "load_whitelist_config",
    "check_path_permission",
    "is_path_writable",
]
