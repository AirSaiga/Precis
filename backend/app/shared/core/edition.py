"""@fileoverview Precis 版本检测模块

功能概述:
- 检测当前运行版本（个人版/团队版）
- 支持环境变量和配置文件多来源判定
"""

import logging
import os
from enum import Enum
from typing import Optional

from app.shared.core.config import ConfigPaths


class Edition(str, Enum):
    """
    @classdesc Precis 版本枚举

    定义产品的两种版本：个人版和社区/团队版。
    用于控制功能开关、权限检查和版本特性区分。

    使用场景:
    - 功能开关：团队版开放高级功能（如多人协作、高级报告）
    - 权限校验：某些 API 仅团队版可用
    - UI 展示：根据版本显示不同的菜单和选项
    """

    PERSONAL = "personal"
    TEAM = "team"


_cached_edition: Optional[Edition] = None


def get_current_edition() -> Edition:
    """
    @methoddesc 检测当前 Precis 版本

    优先级：
    1. 环境变量 PRECIS_EDITION
    2. 配置文件 .precis-edition（项目根目录）
    3. 默认值 personal

    Returns:
        Edition: 当前版本

    Examples:
        >>> get_current_edition()
        <Edition.TEAM: 'team'>

        >>> get_current_edition()
        <Edition.PERSONAL: 'personal'>
    """
    global _cached_edition

    if _cached_edition is not None:
        return _cached_edition

    edition_str = os.getenv("PRECIS_EDITION", "").lower().strip()

    if not edition_str:
        try:
            project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
            # 引入统一配置管理
            # 优先使用新路径
            config_file = str(ConfigPaths.product_edition(project_root))
            # 向后兼容：检查旧路径
            if not os.path.isfile(config_file):
                old_config_file = os.path.join(project_root, ".precis-edition")
                if os.path.isfile(old_config_file):
                    config_file = old_config_file
            if os.path.isfile(config_file):
                with open(config_file, encoding="utf-8") as f:
                    edition_str = f.read().strip().lower()
        except Exception:
            logging.exception("读取版本配置文件失败")

    if edition_str == Edition.TEAM.value:
        _cached_edition = Edition.TEAM
    else:
        _cached_edition = Edition.PERSONAL

    return _cached_edition


def is_team_edition() -> bool:
    """
    @methoddesc 判断当前是否为团队版

    Returns:
        bool: True 表示团队版，False 表示个人版
    """
    return get_current_edition() == Edition.TEAM


def is_personal_edition() -> bool:
    """
    @methoddesc 判断当前是否为个人版

    Returns:
        bool: True 表示个人版，False 表示团队版
    """
    return get_current_edition() == Edition.PERSONAL


def clear_edition_cache() -> None:
    """
    @methoddesc 清除版本缓存

    用于测试或动态切换版本场景
    """
    global _cached_edition
    _cached_edition = None


def set_edition_for_test(edition: Edition) -> None:
    """
    @methoddesc 设置版本（仅用于测试）

    Args:
        edition: 要设置的版本
    """
    global _cached_edition
    _cached_edition = edition
