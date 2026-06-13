"""@fileoverview Precis 统一配置管理模块

功能概述:
- 管理所有配置文件的路径（数据源、Electron、AI 服务商、白名单等）
- 提供项目级/用户级/系统级配置的优先级加载
"""

from pathlib import Path


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
    def ai_providers(cls) -> Path:
        """
        @methoddesc 用户级 AI 配置文件路径

        AI Provider 配置是用户级全局设置（包含 API Key 等敏感信息），
        不属于项目仓库。统一固定存放在 ~/.precis/ai_providers.yaml。
        """
        return cls.USER_CONFIG_DIR / "ai_providers.yaml"


# 便捷导入
__all__ = [
    "ConfigPaths",
]
