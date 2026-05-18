"""@fileoverview 数据预览路径处理模块（兼容层）

功能概述:
- 提供数据预览功能的路径验证和安全检查（已重构为包形式）
- 统一导出新版子模块接口，保持向后兼容

架构设计:
- 门面模式（Facade）: 将分散在 path/ 子包中的功能聚合到单一入口
- 向后兼容: 旧代码直接 from path import xxx 仍可正常工作

输入示例:
    from app.shared.services.preview.path import validate_file_path, get_allowed_directories
    is_valid, msg = validate_file_path("data/users.csv")
    allowed = get_allowed_directories()

输出示例:
    - validate_file_path 返回 (bool, str) 元组，表示（是否有效，错误信息）
    - get_allowed_directories 返回允许访问的目录列表
"""

from app.shared.services.preview.path.permission import (
    check_path_permission,
    is_path_writable,
)
from app.shared.services.preview.path.types import PathPolicy, WhitelistEntry
from app.shared.services.preview.path.validator import validate_file_path
from app.shared.services.preview.path.whitelist import (
    get_allowed_directories,
    is_path_in_allowed_directories,
    load_allowed_paths_from_config,
    load_whitelist_config,
)

# 对外暴露的公共接口列表，控制 import * 时的可见范围
__all__ = [
    "PathPolicy",
    "WhitelistEntry",
    "validate_file_path",
    "get_allowed_directories",
    "load_allowed_paths_from_config",
    "is_path_in_allowed_directories",
    "load_whitelist_config",
    "check_path_permission",
    "is_path_writable",
]
