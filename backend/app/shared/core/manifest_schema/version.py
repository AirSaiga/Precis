"""
@fileoverview Schema 版本管理模块

功能概述:
- 定义配置格式版本常量及支持范围检查
- 提供版本号解析、比较和版本信息查询功能

架构设计:
- 使用模块级常量定义当前版本和支持范围
- 提供纯工具函数，无外部依赖，便于各模块调用

输入示例:
    is_supported_version(2)        -> True
    parse_version("2.1.0")         -> (2, 1, 0)
    compare_versions((2, 0, 0), (2, 1, 0))  -> -1

输出示例:
    get_version_info() -> {
        "current_version": 2,
        "min_supported_version": 2,
        "max_supported_version": 2,
        "supported_versions": [2],
    }
"""

from __future__ import annotations

from typing import Any

# ============================================================================
# 版本常量定义
# ============================================================================

# 当前配置格式版本号
CURRENT_VERSION = 2

# 系统最小支持的配置版本号
MIN_SUPPORTED_VERSION = 2

# 系统最大支持的配置版本号
MAX_SUPPORTED_VERSION = 2


# ============================================================================
# 版本检查与查询函数
# ============================================================================


def is_supported_version(version: int) -> bool:
    """
    @methoddesc 检查指定版本号是否在系统支持范围内。

    参数:
        version: 要检查的版本号（整数）

    返回值:
        bool: 如果版本号在最小和最大支持版本之间（含边界）则返回 True，否则返回 False

    使用示例:
        >>> is_supported_version(2)
        True
        >>> is_supported_version(1)
        False
    """
    return MIN_SUPPORTED_VERSION <= version <= MAX_SUPPORTED_VERSION


def get_version_info() -> dict[str, Any]:
    """
    @methoddesc 获取当前系统的版本信息汇总。

    返回值:
        dict: 包含当前版本、最小支持版本、最大支持版本和支持版本列表的字典

    字段说明:
        - current_version: 当前配置格式版本
        - min_supported_version: 最小支持的版本号
        - max_supported_version: 最大支持的版本号
        - supported_versions: 支持的所有版本号列表（由最小到最大生成的连续整数列表）

    使用示例:
        >>> get_version_info()
        {'current_version': 2, 'min_supported_version': 2, 'max_supported_version': 2, 'supported_versions': [2]}
    """
    return {
        "current_version": CURRENT_VERSION,
        "min_supported_version": MIN_SUPPORTED_VERSION,
        "max_supported_version": MAX_SUPPORTED_VERSION,
        # 生成从最小支持版本到最大支持版本的连续版本号列表
        "supported_versions": list(range(MIN_SUPPORTED_VERSION, MAX_SUPPORTED_VERSION + 1)),
    }


# ============================================================================
# 版本号解析与比较函数
# ============================================================================


def parse_version(version_str: str) -> tuple[int, int, int]:
    """
    @methoddesc 将版本号字符串解析为 (主版本, 次版本, 修订号) 三元组。

    参数:
        version_str: 版本号字符串，格式通常为 "主版本.次版本.修订号"，如 "2.1.0"

    返回值:
        tuple[int, int, int]: (major, minor, patch) 三元组；
                             如果某部分缺失，则对应位置默认为 0

    解析逻辑:
        1. 按小数点分割字符串
        2. 依次取第 1、2、3 部分转为整数
        3. 不足三部分时，缺失部分补 0

    使用示例:
        >>> parse_version("2.1.0")
        (2, 1, 0)
        >>> parse_version("3")
        (3, 0, 0)
    """
    parts = version_str.split(".")
    # 取主版本号，如果不存在则默认为 0
    major = int(parts[0]) if len(parts) > 0 else 0
    # 取次版本号，如果不存在则默认为 0
    minor = int(parts[1]) if len(parts) > 1 else 0
    # 取修订号，如果不存在则默认为 0
    patch = int(parts[2]) if len(parts) > 2 else 0
    return (major, minor, patch)


def compare_versions(v1: tuple[int, int, int], v2: tuple[int, int, int]) -> int:
    """
    @methoddesc 比较两个版本号三元组的大小。

    参数:
        v1: 第一个版本号三元组 (major, minor, patch)
        v2: 第二个版本号三元组 (major, minor, patch)

    返回值:
        int: -1 表示 v1 < v2，0 表示 v1 == v2，1 表示 v1 > v2

    比较逻辑:
        直接利用 Python 元组的字典序比较特性：
        先比较主版本，若相同再比较次版本，若仍相同再比较修订号

    使用示例:
        >>> compare_versions((2, 0, 0), (2, 1, 0))
        -1
        >>> compare_versions((3, 0, 0), (2, 9, 9))
        1
        >>> compare_versions((1, 1, 1), (1, 1, 1))
        0
    """
    # 利用 Python 元组的字典序比较特性进行版本号大小判断
    if v1 < v2:
        return -1
    elif v1 > v2:
        return 1
    else:
        return 0
