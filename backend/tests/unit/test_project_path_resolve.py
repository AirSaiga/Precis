"""@fileoverview _resolve_project_path 单元测试

B-arch2: 验证项目内相对路径解析的安全约束（防路径穿越 + symlink 逃逸）。
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.api.routers.project.helpers import _resolve_project_path


def _has_symlink_support() -> bool:
    """检测当前环境是否支持创建 symlink（Windows 需管理员/开发者模式）。"""
    import tempfile

    with tempfile.TemporaryDirectory() as d:
        target = Path(d, "target")
        target.mkdir()
        link = Path(d, "link")
        try:
            link.symlink_to(target)
            return True
        except (OSError, NotImplementedError):
            return False


class TestResolveProjectPath:
    def test_normal_relative_path(self, tmp_path):
        """正常相对路径解析到项目根下。"""
        result = _resolve_project_path(str(tmp_path), "schemas/users.yaml")
        assert result == str(Path(tmp_path, "schemas/users.yaml").resolve())

    def test_dotdot_escape_rejected(self, tmp_path):
        """含 .. 逃逸出项目根应被拒。"""
        with pytest.raises(ValueError, match="traversal"):
            _resolve_project_path(str(tmp_path), "../../../etc/passwd")

    @pytest.mark.skipif(
        not _has_symlink_support(),
        reason="当前环境不支持创建 symlink（Windows 需管理员权限）",
    )
    def test_symlink_escape_rejected(self, tmp_path):
        """B-arch2: symlink 指向项目外，通过相对路径访问应被 resolve 拒绝。

        原实现用 os.path.abspath 不解析 symlink，会通过 startswith 检查；
        新实现用 Path.resolve() 展开 symlink 后再判包含关系，能正确拒绝。
        """
        # 项目外目标
        outside = tmp_path.parent / "outside_secret"
        outside.mkdir(exist_ok=True)
        (outside / "secret.txt").write_text("sensitive", encoding="utf-8")
        # 项目内 symlink 指向外部
        link = tmp_path / "evil_link"
        link.symlink_to(outside)

        # 通过 symlink 访问外部文件，resolve 后落在项目外，应被拒
        with pytest.raises(ValueError, match="traversal"):
            _resolve_project_path(str(tmp_path), "evil_link/secret.txt")

    def test_resolve_actually_called(self, tmp_path, monkeypatch):
        """B-arch2: 验证实现确实调用 resolve（而非仅 abspath）。

        通过 mock Path.resolve 确认被调用——这是抵御 symlink 逃逸的关键。
        """
        called = {"n": 0}
        original_resolve = Path.resolve

        def spy_resolve(self, *args, **kwargs):
            called["n"] += 1
            return original_resolve(self, *args, **kwargs)

        monkeypatch.setattr(Path, "resolve", spy_resolve)
        _resolve_project_path(str(tmp_path), "schemas/users.yaml")
        assert called["n"] >= 2  # base 与 target 都应 resolve
