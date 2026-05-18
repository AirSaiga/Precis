"""@fileoverview 通用 IO 工具模块入口

功能概述:
- 统一导出 YAML 读写工具（read_yaml、write_yaml）
"""

from .yaml import read_yaml, write_yaml

__all__ = ["read_yaml", "write_yaml"]
