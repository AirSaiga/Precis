"""@fileoverview Precis 版本检测模块

功能概述:
- 检测当前运行版本（个人版/团队版）
- 支持环境变量和配置文件多来源判定
"""

# 1. 标准库导入
import logging
import os
from enum import Enum
from typing import Optional

# 2. 项目内部导入
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


# 全局缓存变量，避免重复读取文件系统
_cached_edition: Optional[Edition] = None


def get_current_edition() -> Edition:
    """
    @methoddesc 检测当前 Precis 版本

    按以下优先级依次判定当前版本：
    1. 环境变量 PRECIS_EDITION（最高优先级，适合 CI/CD 和容器部署）
    2. 配置文件 .precis-edition（项目根目录，适合开发环境）
    3. 默认值 personal（兜底策略）

    首次调用后会将结果缓存到模块级变量 _cached_edition 中，
    后续调用直接返回缓存值以减少 I/O 开销。

    Returns:
        Edition: 当前检测到的版本枚举值

    Raises:
        本函数不抛出异常，文件读取失败会静默降级到默认值。

    Examples:
        >>> get_current_edition()
        <Edition.TEAM: 'team'>

        >>> get_current_edition()
        <Edition.PERSONAL: 'personal'>
    """
    global _cached_edition

    # 若已缓存则直接返回，避免重复的文件 I/O 操作
    if _cached_edition is not None:
        return _cached_edition

    # 步骤 1：尝试从环境变量读取版本标识
    edition_str = os.getenv("PRECIS_EDITION", "").lower().strip()

    # 步骤 2：环境变量未设置时，尝试从配置文件读取
    if not edition_str:
        try:
            # 计算项目根目录（当前文件位于 backend/app/shared/core/，向上回溯三级）
            project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
            # 引入统一配置管理
            # 优先使用新路径（ConfigPaths 提供的标准路径）
            config_file = str(ConfigPaths.product_edition(project_root))
            # 向后兼容：若新路径不存在，则回退到旧路径 .precis-edition
            if not os.path.isfile(config_file):
                old_config_file = os.path.join(project_root, ".precis-edition")
                if os.path.isfile(old_config_file):
                    config_file = old_config_file
            # 读取配置文件内容并标准化（小写 + 去空白）
            if os.path.isfile(config_file):
                with open(config_file, encoding="utf-8") as f:
                    edition_str = f.read().strip().lower()
        except Exception:
            # 配置文件读取失败时不阻断流程，记录异常后继续使用空字符串
            logging.exception("读取版本配置文件失败")

    # 步骤 3：映射字符串到枚举值，仅识别 "team"，其余一律视为个人版
    if edition_str == Edition.TEAM.value:
        _cached_edition = Edition.TEAM
    else:
        _cached_edition = Edition.PERSONAL

    return _cached_edition


def is_team_edition() -> bool:
    """
    @methoddesc 判断当前是否为团队版

    便捷函数，封装 get_current_edition() 的调用，
    常用于权限校验和功能开关判断。

    Returns:
        bool: True 表示团队版，False 表示个人版
    """
    return get_current_edition() == Edition.TEAM


def is_personal_edition() -> bool:
    """
    @methoddesc 判断当前是否为个人版

    便捷函数，与 is_team_edition() 互为补集。

    Returns:
        bool: True 表示个人版，False 表示团队版
    """
    return get_current_edition() == Edition.PERSONAL


def clear_edition_cache() -> None:
    """
    @methoddesc 清除版本缓存

    将模块级缓存变量 _cached_edition 重置为 None，
    使下一次 get_current_edition() 调用重新执行完整检测逻辑。

    主要用于：
    - 单元测试中切换版本环境后重置状态
    - 动态切换版本配置后的热刷新场景
    """
    global _cached_edition
    _cached_edition = None


def set_edition_for_test(edition: Edition) -> None:
    """
    @methoddesc 设置版本（仅用于测试）

    强制覆盖版本缓存，绕过环境变量和配置文件的检测逻辑。
    注意：此函数仅应在测试代码中使用，生产代码应通过环境变量或配置文件控制版本。

    Args:
        edition: 要强制设置的版本枚举值
    """
    global _cached_edition
    _cached_edition = edition
