"""@fileoverview validate 命令抑制配置自检日志噪声的单元测试

验证 validate 执行时：
- 配置自检（inspect_config）仍运行，loading_errors 含自检级错误（如 IdMismatchWarning）
- 但 [配置自检] WARNING 日志行不输出到 stderr（噪声被抑制）
- 加载警告区展示完整详情（title/description/fix_hint），而非空的 error_type

通过构造 manifest 引用 ID 与 schema 文件内部 ID 不一致的项目触发自检错误。
"""

from __future__ import annotations

import logging
import os
import sys

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

from app.cli.shell.commands.validate import ValidateCommand


def _make_id_mismatch_project(tmp_path):
    """构造 manifest ID 与 schema 文件内部 ID 不一致的项目。

    该不一致由 inspect_config 的 ID 一致性检查发现（IdMismatchWarning），
    用于触发配置自检产出 loading_error，验证日志被抑制而数据仍保留。
    返回 (manifest_path, data_dir)。
    """
    manifest = tmp_path / "project.precis.yaml"
    manifest.write_text(
        """
version: 2
project:
  id: test-project
  name: Test Project
schemas:
  - id: users_old
    path: schemas/users.schema.yaml
""",
        encoding="utf-8",
    )

    schemas_dir = tmp_path / "schemas"
    schemas_dir.mkdir()
    (schemas_dir / "users.schema.yaml").write_text(
        """
version: 2
id: users
name: users
columns:
  - id: user_id
    name: user_id
    type: string
""",
        encoding="utf-8",
    )
    return str(manifest), str(tmp_path)


class TestValidateInspectSuppression:
    def test_inspect_logger_suppressed_during_validate(self, tmp_path, capsys):
        """validate 期间 inspector logger 被调到 ERROR，[配置自检] 日志不输出。"""
        manifest_path, data_dir = _make_id_mismatch_project(tmp_path)
        cmd = ValidateCommand()

        cmd._run_validation(manifest_path, data_dir, None, {}, {})

        captured = capsys.readouterr()
        # stderr 不应出现 [配置自检] 噪声行
        assert "[配置自检]" not in captured.err

    def test_inspect_logger_restored_after_validate(self, tmp_path):
        """validate 结束后 inspector logger 级别恢复原值。"""
        manifest_path, data_dir = _make_id_mismatch_project(tmp_path)
        cmd = ValidateCommand()
        inspector_logger = logging.getLogger("app.shared.core.project.loader.loader_parts.config_inspector")
        original_level = inspector_logger.level

        cmd._run_validation(manifest_path, data_dir, None, {}, {})

        # 级别应恢复为执行前（通常是 WARNING=30，CLI 启动时设置）
        assert inspector_logger.level == original_level

    def test_loading_errors_show_full_details(self, tmp_path, capsys):
        """加载警告区展示 title/description/fix_hint，而非空的 error_type。"""
        manifest_path, data_dir = _make_id_mismatch_project(tmp_path)
        cmd = ValidateCommand()

        cmd._run_validation(manifest_path, data_dir, None, {}, {})

        captured = capsys.readouterr().out
        # 应出现加载警告区标题
        assert "加载警告" in captured
        # 不应出现形如 "  - IdMismatchWarning: " 后跟空内容（旧 bug 的特征）
        # 新格式为 "  - [IdMismatchWarning] <title>"
        assert "[IdMismatchWarning]" in captured
