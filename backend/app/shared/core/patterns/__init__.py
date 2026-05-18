"""@fileoverview 表达式模式模块入口

功能概述:
- 导出表达式模式加载函数（load_patterns_from_config）
"""

from .loader import load_patterns_from_config

__all__ = ["load_patterns_from_config"]
