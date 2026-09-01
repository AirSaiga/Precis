"""config set 命令单元测试。

验证修复后的三项行为契约：
1. 设置值生效（含点号路径、类型解析、中间层级自动创建）；
2. 最小编辑语义——未改行原样保留（注释、空行、行内格式不丢）；
3. 路径穿越被拒（find_config_file 防护：``..``、绝对路径、项目外文件）。

原子性不做细测（依赖 os.replace 语义，非本层可测）。
"""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from app.cli.shell.commands.base import ProjectContext
from app.cli.shell.commands.config.set import ConfigSetCommand

# 带注释与行内格式的初始配置内容（用于验证注释保留）
INITIAL_YAML = (
    "# 项目清单\nproject:\n  # 项目名\n  name: demo  # 行内注释\n  version: 1\nvalidation:\n  auto_validate: false\n"
)


@pytest.fixture
def project_dir(tmp_path: Path) -> Path:
    """创建含带注释配置文件的项目根目录。"""
    (tmp_path / "project.precis.yaml").write_text(INITIAL_YAML, encoding="utf-8")
    return tmp_path


@pytest.fixture
def context(project_dir: Path) -> ProjectContext:
    """构造已打开项目的上下文。"""
    ctx = ProjectContext()
    ctx.project_path = str(project_dir)
    return ctx


def test_set_updates_value(context: ProjectContext, project_dir: Path) -> None:
    """设置值生效：目标键被更新且可读回。"""
    result = ConfigSetCommand().execute(["project.precis.yaml", "project.name", '"My Project"'], context)
    assert result.success is True
    data = yaml.safe_load((project_dir / "project.precis.yaml").read_text("utf-8"))
    assert data["project"]["name"] == "My Project"


def test_set_parses_value_types(context: ProjectContext, project_dir: Path) -> None:
    """值类型解析保持既有语义：true → True、整数、浮点。"""
    cmd = ConfigSetCommand()
    assert cmd.execute(["project.precis.yaml", "validation.auto_validate", "true"], context).success
    assert cmd.execute(["project.precis.yaml", "project.version", "2"], context).success
    assert cmd.execute(["project.precis.yaml", "project.threshold", "1.5"], context).success
    data = yaml.safe_load((project_dir / "project.precis.yaml").read_text("utf-8"))
    assert data["validation"]["auto_validate"] is True
    assert data["project"]["version"] == 2
    assert data["project"]["threshold"] == 1.5


def test_set_creates_intermediate_levels(context: ProjectContext, project_dir: Path) -> None:
    """中间层级不存在时自动创建（与 set_by_dotpath 语义一致）。"""
    result = ConfigSetCommand().execute(["project.precis.yaml", "a.b.c", "42"], context)
    assert result.success is True
    data = yaml.safe_load((project_dir / "project.precis.yaml").read_text("utf-8"))
    assert data["a"]["b"]["c"] == 42


def test_set_preserves_comments_and_untouched_lines(context: ProjectContext, project_dir: Path) -> None:
    """最小编辑语义：未改行原样保留（含独立注释、行内注释、缩进与空格）。"""
    result = ConfigSetCommand().execute(["project.precis.yaml", "validation.auto_validate", "true"], context)
    assert result.success is True
    raw = (project_dir / "project.precis.yaml").read_text("utf-8")
    # 未涉及的行必须逐字保留（safe_load+dump 全量重写做不到这一点）
    assert "# 项目清单" in raw
    assert "  # 项目名" in raw
    assert "  name: demo  # 行内注释" in raw
    assert "  version: 1" in raw
    # 目标行的值已替换
    assert "  auto_validate: true" in raw


def test_set_rejects_parent_directory_traversal(context: ProjectContext, project_dir: Path, tmp_path: Path) -> None:
    """路径穿越被拒：``..`` 指向项目外的文件不允许写入。"""
    result = ConfigSetCommand().execute(["../evil.yaml", "a.b", "1"], context)
    assert result.success is False
    assert (tmp_path / "evil.yaml").exists() is False


def test_set_rejects_absolute_path(context: ProjectContext, tmp_path: Path) -> None:
    """路径穿越被拒：绝对路径不允许写入。"""
    outside = tmp_path / "outside.yaml"
    outside.write_text("x: 0\n", encoding="utf-8")
    result = ConfigSetCommand().execute([str(outside), "x", "1"], context)
    assert result.success is False
    assert yaml.safe_load(outside.read_text("utf-8")) == {"x": 0}


def test_set_missing_file_errors(context: ProjectContext) -> None:
    """配置文件不存在时报错。"""
    result = ConfigSetCommand().execute(["nonexistent.yaml", "a.b", "1"], context)
    assert result.success is False
    assert "nonexistent.yaml" in result.message


def test_set_errors_preserve_original_file(context: ProjectContext, project_dir: Path) -> None:
    """写入失败（中间键非字典）时不损坏原文件。"""
    result = ConfigSetCommand().execute(["project.precis.yaml", "project.name.sub", "1"], context)
    assert result.success is False
    # 原文件内容不变（原子写：临时文件失败被清理，原文件未被替换）
    assert (project_dir / "project.precis.yaml").read_text("utf-8") == INITIAL_YAML
