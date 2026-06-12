"""@fileoverview Precis 统一配置管理模块

功能概述:
- 管理所有配置文件的路径（数据源、Electron、AI 服务商、白名单等）
- 提供项目级/用户级/系统级配置的优先级加载
"""

import os
from pathlib import Path
from typing import Optional


class ConfigPaths:
    """
    @classdesc 统一配置路径管理类

    所有配置文件路径的集中定义，避免硬编码分散在代码各处。
    """

    # 项目级配置目录名
    PROJECT_CONFIG_DIR = ".precis"

    # Electron 配置目录
    ELECTRON_DIR = "electron"

    # 用户级配置目录（用户主目录下）
    USER_CONFIG_DIR = Path.home() / ".precis"

    # 系统级配置目录（仅 Unix）
    SYSTEM_CONFIG_DIR = Path("/etc/precis")

    @classmethod
    def get_project_config_dir(cls, project_root: str) -> Path:
        """
        @methoddesc 获取项目配置目录路径

        参数:
            project_root: 项目根目录的绝对路径字符串

        返回:
            项目配置目录的 Path 对象（{project_root}/.precis）
        """
        return Path(project_root) / cls.PROJECT_CONFIG_DIR

    @classmethod
    def ensure_project_config_dir(cls, project_root: str) -> Path:
        """
        @methoddesc 确保项目配置目录存在，不存在则创建

        参数:
            project_root: 项目根目录的绝对路径字符串

        返回:
            已存在或新创建的目录的 Path 对象
        """
        config_dir = cls.get_project_config_dir(project_root)
        config_dir.mkdir(parents=True, exist_ok=True)
        return config_dir

    # ==================== 数据源配置 ====================

    @classmethod
    def data_sources(cls, project_root: str) -> Path:
        """
        @methoddesc 数据源和 UI 状态配置文件路径

        存储内容：
        - 已添加的数据源列表（文件路径、类型、状态）
        - UI 状态（资源树展开状态等）
        """
        return cls.get_project_config_dir(project_root) / "data_sources.yaml"

    # ==================== Electron 启动配置 ====================

    @classmethod
    def electron_launch(cls, project_root: str) -> Path:
        """
        @methoddesc Electron 桌面版启动配置文件路径

        存储内容：
        - config_path: 项目配置路径
        - data_path: 数据文件路径

        位置：优先放在 electron/ 目录，其次 .precis/
        """
        # 优先使用 electron/ 目录
        electron_dir = Path(project_root) / cls.ELECTRON_DIR
        if electron_dir.exists():
            return electron_dir / "electron_launch.yaml"
        # 备选：放在 .precis/ 目录
        return cls.get_project_config_dir(project_root) / "electron_launch.yaml"

    # ==================== AI 服务商配置 ====================

    @classmethod
    def ai_providers_project(cls, project_root: str) -> Path:
        """
        @methoddesc 项目级 AI 配置文件路径

        参数:
            project_root: 项目根目录路径

        返回:
            项目级 AI 配置文件 Path 对象
        """
        return cls.get_project_config_dir(project_root) / "ai_providers.yaml"

    @classmethod
    def ai_providers_user(cls) -> Path:
        """
        @methoddesc 用户级 AI 配置文件路径

        返回:
            用户主目录下 ~/.precis/ai_providers.yaml 的 Path 对象
        """
        return cls.USER_CONFIG_DIR / "ai_providers.yaml"

    @classmethod
    def ai_providers_system(cls) -> Path:
        """
        @methoddesc 系统级 AI 配置文件路径（仅 Unix 系统有效）

        返回:
            /etc/precis/ai_providers.yaml 的 Path 对象
        """
        return cls.SYSTEM_CONFIG_DIR / "ai_providers.yaml"

    @classmethod
    def ai_providers(cls, project_root: Optional[str] = None) -> Path:
        """
        @methoddesc AI 服务商配置文件（按优先级返回）

        优先级：
        1. 项目级：{project}/.precis/ai_providers.yaml
        2. 用户级：~/.precis/ai_providers.yaml
        3. 系统级：/etc/precis/ai_providers.yaml（Unix only）

        如果不存在，返回用户级路径（用于创建）
        """
        # 1. 项目级
        if project_root:
            project_path = cls.ai_providers_project(project_root)
            if project_path.exists():
                return project_path

        # 2. 用户级
        user_path = cls.ai_providers_user()
        if user_path.exists():
            return user_path

        # 3. 系统级（仅 Unix）
        if os.name != "nt":  # 非 Windows
            system_path = cls.ai_providers_system()
            if system_path.exists():
                return system_path

        # 默认返回用户级路径
        return user_path

    @classmethod
    def get_all_ai_providers_paths(cls, project_root: Optional[str] = None) -> list[Path]:
        """
        @methoddesc 获取所有可能的 AI 配置文件路径

        返回所有级别（项目级/用户级/系统级）的配置文件路径，
        用于显示和调试，不检查文件是否存在。

        参数:
            project_root: 可选，项目根目录路径

        返回:
            AI 配置文件路径列表
        """
        paths = []

        if project_root:
            paths.append(cls.ai_providers_project(project_root))
        paths.append(cls.ai_providers_user())
        if os.name != "nt":
            paths.append(cls.ai_providers_system())

        return paths


# 便捷导入
__all__ = [
    "ConfigPaths",
]
