"""
配置路径管理单元测试

测试覆盖:
- ConfigPaths 各类路径生成方法
- 多级配置优先级 (ai_providers)
- 目录存在性判断 (electron_launch)
"""

from app.shared.core.config import ConfigPaths

# ============================================================================
# ConfigPaths
# ============================================================================


class TestConfigPaths:
    def test_get_project_config_dir(self):
        """项目配置目录路径构造正确"""
        path = ConfigPaths.get_project_config_dir("/tmp/project")
        assert path.name == ".precis"
        assert "project" in str(path)

    def test_ensure_project_config_dir(self, tmp_path):
        """目录不存在时自动创建"""
        root = str(tmp_path / "myproj")
        path = ConfigPaths.ensure_project_config_dir(root)
        assert path.exists()
        assert path.is_dir()
        assert path.name == ".precis"

    def test_data_sources(self):
        """数据源配置文件路径"""
        path = ConfigPaths.data_sources("/tmp/project")
        assert path.name == "data_sources.yaml"
        assert ".precis" in str(path)

    def test_electron_launch_priority_electron_dir(self, tmp_path):
        """electron 目录存在时优先使用该目录"""
        (tmp_path / "electron").mkdir()
        path = ConfigPaths.electron_launch(str(tmp_path))
        assert "electron" in str(path)
        assert path.name == "electron_launch.yaml"

    def test_electron_launch_fallback_precis(self, tmp_path):
        """electron 目录不存在时回退到 .precis"""
        path = ConfigPaths.electron_launch(str(tmp_path))
        assert ".precis" in str(path)
        assert path.name == "electron_launch.yaml"

    def test_ai_providers(self):
        """AI Provider 配置固定为用户级路径"""
        path = ConfigPaths.ai_providers()
        assert path.name == "ai_providers.yaml"
        assert str(path.parent).endswith(".precis")
