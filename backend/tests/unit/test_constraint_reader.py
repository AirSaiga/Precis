"""
@fileoverview 约束读取模块单元测试

测试 load_constraint 和 load_constraints。
"""

import os
import sys
import tempfile

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

import pytest

from app.shared.core.project.constraint.reader import load_constraint, load_constraints
from app.shared.core.project.constraint.types import ConstraintFile


class TestLoadConstraint:
    def test_load_valid_constraint(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".constraint.yaml", delete=False, encoding="utf-8") as f:
            f.write("""
version: 2
id: unique_email
type: Unique
enabled: true
description: "邮箱唯一"
refs:
  table_id: users
  column_ids: [email]
params: {}
""")
            path = f.name
        try:
            c = load_constraint(path)
            assert isinstance(c, ConstraintFile)
            assert c.id == "unique_email"
            assert c.type == "Unique"
        finally:
            os.unlink(path)

    def test_load_invalid_yaml_raises(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".constraint.yaml", delete=False, encoding="utf-8") as f:
            f.write("invalid_yaml: [")
            path = f.name
        try:
            with pytest.raises(Exception):
                load_constraint(path)
        finally:
            os.unlink(path)


class TestLoadConstraints:
    def test_load_multiple(self):
        files = []
        try:
            for cid in ["c1", "c2"]:
                with tempfile.NamedTemporaryFile(
                    mode="w", suffix=".constraint.yaml", delete=False, encoding="utf-8"
                ) as f:
                    f.write(f"""
version: 2
id: {cid}
type: NotNull
enabled: true
refs:
  table_id: users
  column_id: name
params: {{}}
""")
                    files.append(f.name)
            result = load_constraints(files)
            assert len(result) == 2
            assert "c1" in result
            assert "c2" in result
        finally:
            for p in files:
                os.unlink(p)
