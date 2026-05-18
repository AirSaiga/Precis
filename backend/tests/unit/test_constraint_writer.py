"""
@fileoverview 约束写入模块单元测试

测试 save_constraint 函数。
"""

import os
import sys
import tempfile

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)


from app.shared.core.project.constraint.types import ConstraintFile
from app.shared.core.project.constraint.writer import save_constraint


class TestSaveConstraint:
    def test_saves_constraint_to_file(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, "test.constraint.yaml")
            constraint = ConstraintFile(
                version=2,
                id="unique_email",
                type="Unique",
                enabled=True,
                description="邮箱唯一",
                refs={"table_id": "users", "column_ids": ["email"]},
                params={},
            )
            save_constraint(constraint, path)
            assert os.path.exists(path)
            with open(path, encoding="utf-8") as f:
                content = f.read()
            assert "unique_email" in content
            assert "Unique" in content

    def test_saves_with_path_object(self):
        from pathlib import Path

        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "test.constraint.yaml"
            constraint = ConstraintFile(
                version=2,
                id="not_null_name",
                type="NotNull",
                enabled=True,
                refs={"table_id": "users", "column_id": "name"},
                params={},
            )
            save_constraint(constraint, path)
            assert path.exists()
