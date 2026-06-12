"""
@fileoverview 测试 manifest constraint 去重 API

覆盖场景:
- 正常去重（manifest 中存在 1 条正确 + 1 条错误指向同一文件）
- 没有重复时返回 0
- 表中只指向唯一文件时不去重
- 安全保证：只删 manifest 条目，不修改任何约束文件
"""

import pytest


@pytest.fixture
def tmp_project_with_dup_constraint(tmp_path):
    """
    构造一个含重复 manifest constraint 引用的临时项目。
    """
    project_root = tmp_path
    (project_root / "schemas").mkdir()
    (project_root / "constraints").mkdir()

    # schema
    (project_root / "schemas" / "users.schema.yaml").write_text(
        """\
version: 2
id: users
name: users
columns:
  - id: id
    name: id
    type: integer
""",
        encoding="utf-8",
    )

    # 约束文件
    (project_root / "constraints" / "notnull_id.constraint.yaml").write_text(
        """\
version: 2
id: c_notnull_id
type: NotNull
enabled: true
refs:
  table_id: users
  column_id: id
""",
        encoding="utf-8",
    )

    # manifest 含两条 ref 指向同一文件，id 不同的为"错误条目"
    (project_root / "project.precis.yaml").write_text(
        """\
version: 2
project:
  id: test-project
  name: Test Project
schemas:
  - id: users
    path: schemas/users.schema.yaml
constraints:
  - id: c_notnull_id
    path: constraints/notnull_id.constraint.yaml
  - id: notnull_id
    path: constraints/notnull_id.constraint.yaml
""",
        encoding="utf-8",
    )

    return project_root


def test_deduplicate_removes_bad_ref(tmp_project_with_dup_constraint):
    """正常去重：应删除 ref.id != file.id 的条目"""
    from app.api.routers.project.manifest import deduplicate_constraint_refs

    config_path = str(tmp_project_with_dup_constraint)
    result = deduplicate_constraint_refs(config_path)
    assert "已删除 1 个重复条目" in result["message"]

    # 重新读取 manifest，应只剩 c_notnull_id
    import yaml

    manifest_data = yaml.safe_load(
        (tmp_project_with_dup_constraint / "project.precis.yaml").read_text(encoding="utf-8")
    )
    ids = [c["id"] for c in manifest_data["constraints"]]
    assert ids == ["c_notnull_id"]


def test_deduplicate_no_dup_noop(tmp_path):
    """没有重复时返回 0"""
    from app.api.routers.project.manifest import deduplicate_constraint_refs

    (tmp_path / "schemas").mkdir()
    (tmp_path / "constraints").mkdir()
    (tmp_path / "schemas" / "users.schema.yaml").write_text(
        "version: 2\nid: users\nname: users\ncolumns:\n  - id: id\n    name: id\n    type: integer\n",
        encoding="utf-8",
    )
    (tmp_path / "constraints" / "c_notnull_id.constraint.yaml").write_text(
        "version: 2\nid: c_notnull_id\ntype: NotNull\nrefs:\n  table_id: users\n  column_id: id\n",
        encoding="utf-8",
    )
    (tmp_path / "project.precis.yaml").write_text(
        """\
version: 2
project:
  id: test
  name: Test
schemas:
  - id: users
    path: schemas/users.schema.yaml
constraints:
  - id: c_notnull_id
    path: constraints/c_notnull_id.constraint.yaml
""",
        encoding="utf-8",
    )

    result = deduplicate_constraint_refs(str(tmp_path))
    assert "未发现" in result["message"] or "0 个" in result["message"]


def test_deduplicate_preserves_constraint_file(tmp_project_with_dup_constraint):
    """安全保证：去重操作不应修改任何约束文件内容"""
    from app.api.routers.project.manifest import deduplicate_constraint_refs

    constraint_file = tmp_project_with_dup_constraint / "constraints" / "notnull_id.constraint.yaml"
    original_content = constraint_file.read_text(encoding="utf-8")
    original_mtime = constraint_file.stat().st_mtime_ns

    deduplicate_constraint_refs(str(tmp_project_with_dup_constraint))

    # 文件内容必须完全不变
    assert constraint_file.read_text(encoding="utf-8") == original_content
    assert constraint_file.stat().st_mtime_ns == original_mtime
