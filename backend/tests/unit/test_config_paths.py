"""
配置路径管理单元测试

测试覆盖:
- ConfigPaths 各类路径生成方法
- 多级配置优先级 (ai_providers)
- 目录存在性判断 (electron_launch)
"""

import os
import sys

project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if project_root not in sys.path:
    sys.path.insert(0, project_root)


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

    def test_ai_providers_project(self):
        """项目级 AI 配置路径"""
        path = ConfigPaths.ai_providers_project("/tmp/project")
        assert path.name == "ai_providers.yaml"
        assert ".precis" in str(path)

    def test_ai_providers_user(self):
        """用户级 AI 配置路径"""
        path = ConfigPaths.ai_providers_user()
        assert path.name == "ai_providers.yaml"
        assert str(path.parent).endswith(".precis")

    def test_ai_providers_system(self):
        """系统级 AI 配置路径"""
        path = ConfigPaths.ai_providers_system()
        assert path.name == "ai_providers.yaml"
        assert path.parent.name == "precis"

    def test_ai_providers_priority_project(self, tmp_path, monkeypatch):
        """项目级配置存在时优先返回"""
        config_dir = tmp_path / ".precis"
        config_dir.mkdir()
        (config_dir / "ai_providers.yaml").write_text("project")
        # 屏蔽用户级，避免真实 home 干扰
        monkeypatch.setattr(
            ConfigPaths, "ai_providers_user", classmethod(lambda cls: tmp_path / "user" / "ai_providers.yaml")
        )
        result = ConfigPaths.ai_providers(str(tmp_path))
        assert ".precis" in str(result)

    def test_ai_providers_priority_user(self, tmp_path, monkeypatch):
        """用户级配置存在且项目级不存在时返回用户级"""
        user_path = tmp_path / "user_ai.yaml"
        user_path.write_text("user")
        monkeypatch.setattr(ConfigPaths, "ai_providers_user", classmethod(lambda cls: user_path))
        monkeypatch.setattr(ConfigPaths, "ai_providers_system", classmethod(lambda cls: tmp_path / "sys_ai.yaml"))
        result = ConfigPaths.ai_providers(str(tmp_path))
        assert result == user_path

    def test_ai_providers_fallback_user(self, tmp_path, monkeypatch):
        """所有级别都不存在时默认返回用户级路径"""
        user_path = tmp_path / "user_ai.yaml"
        monkeypatch.setattr(ConfigPaths, "ai_providers_user", classmethod(lambda cls: user_path))
        monkeypatch.setattr(ConfigPaths, "ai_providers_system", classmethod(lambda cls: tmp_path / "sys_ai.yaml"))
        result = ConfigPaths.ai_providers(str(tmp_path))
        assert result == user_path

    def test_ai_providers_system_on_unix(self, tmp_path, monkeypatch):
        """Unix 系统且系统级配置存在时返回系统级"""
        monkeypatch.setattr(os, "name", "posix")
        system_path = tmp_path / "sys_ai.yaml"
        system_path.write_text("system")
        monkeypatch.setattr(ConfigPaths, "ai_providers_system", classmethod(lambda cls: system_path))
        monkeypatch.setattr(ConfigPaths, "ai_providers_user", classmethod(lambda cls: tmp_path / "user_ai.yaml"))
        # 传入 None 避免在 Windows 上构造 PosixPath
        result = ConfigPaths.ai_providers(project_root=None)
        assert result == system_path

    def test_get_all_ai_providers_paths(self):
        """返回所有可能的 AI 配置路径"""
        paths = ConfigPaths.get_all_ai_providers_paths("/tmp/project")
        # Windows 下不含系统级路径
        expected_count = 2 if os.name == "nt" else 3
        assert len(paths) == expected_count

    def test_allowed_paths(self):
        """路径白名单配置文件路径"""
        path = ConfigPaths.allowed_paths("/tmp/project")
        assert path.name == "allowed_paths.txt"

    def test_product_edition(self):
        """产品版本标识文件路径"""
        path = ConfigPaths.product_edition("/tmp/project")
        assert path.name == "product_edition"

    def test_cli_ai_config(self):
        """CLI AI 配置文件路径"""
        path = ConfigPaths.cli_ai_config()
        assert path.name == "cli_ai_config.yaml"

    def test_cli_ai_key(self):
        """CLI AI 密钥文件路径"""
        path = ConfigPaths.cli_ai_key()
        assert path.name == ".cli_key"
