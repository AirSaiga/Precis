"""
@fileoverview 约束文件删除行为测试
"""

from __future__ import annotations

from app.shared.services.llm.constraints.constraint_deletion import delete_constraint_file


class TestDeleteConstraintFile:
    """delete_constraint_file 行为"""

    def test_deletes_existing_file(self, tmp_path):
        constraints_dir = tmp_path / "constraints"
        constraints_dir.mkdir()
        constraint_file = constraints_dir / "notnull_users_email.constraint.yaml"
        constraint_file.write_text("id: test\n", encoding="utf-8")

        success, msg = delete_constraint_file("NotNull", "users", "email", str(tmp_path))
        assert success is True
        assert msg == "notnull_users_email"
        assert not constraint_file.exists()

    def test_returns_false_when_file_missing(self, tmp_path):
        constraints_dir = tmp_path / "constraints"
        constraints_dir.mkdir()

        success, msg = delete_constraint_file("NotNull", "nonexistent", "col", str(tmp_path))
        assert success is False
        assert "不存在" in msg
