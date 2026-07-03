"""@fileoverview diff_compute 单元测试

覆盖：
- dry-run 不落盘(hash 校验真实文件前后一致)
- diff 正确性(创建/修改/删除)
- 失败透传
- 临时目录清理
"""

from __future__ import annotations

import hashlib
import os
import pathlib
import tempfile

from app.shared.services.llm.actions.diff_compute import (
    _build_file_diff,
    _shadow_copy,
    compute_action_diff,
)

# =============================================================================
# Factory 函数
# =============================================================================


def make_workspace(base: pathlib.Path) -> str:
    """创建临时项目目录，含最小 project.precis.yaml。"""
    ws = base / "project"
    ws.mkdir()
    (ws / "project.precis.yaml").write_text(
        "version: 2\nproject:\n  id: test\n  name: Test\nschemas: []\n", encoding="utf-8"
    )
    (ws / "schemas").mkdir()
    return str(ws)


def make_add_constraint_action(table_name: str = "users", column: str = "email") -> dict:
    """构造一个 ADD_CONSTRAINT_NODE action。"""
    return {
        "actionType": "ADD_CONSTRAINT_NODE",
        "constraintSpec": {
            "type": "NotNull",
            "tableName": table_name,
            "targetColumn": column,
            "isInline": True,
            "constraintFile": f"schemas/{table_name}.schema.yaml",
        },
    }


def write_users_schema_with_email(ws: str) -> None:
    """写入含 email 列的 users schema（供断言"成功落盘"的测试使用）。

    action_handlers 现在对"列不存在"返回失败（不再静默成功），
    故需要真实列才能让 ADD_CONSTRAINT_NODE 产生 modified diff。
    """
    schema_path = os.path.join(ws, "schemas", "users.schema.yaml")
    os.makedirs(os.path.dirname(schema_path), exist_ok=True)
    with open(schema_path, "w", encoding="utf-8") as f:
        f.write("name: users\ncolumns:\n  - id: col_email\n    name: email\n    type: string\n")


def sha256_file(path: str) -> str:
    """计算文件的 SHA-256 hash。"""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(8192):
            h.update(chunk)
    return h.hexdigest()


def sha256_dir(dir_path: str) -> dict[str, str]:
    """递归计算目录下所有文件的 SHA-256 hash。"""
    result = {}
    for root, _dirs, files in os.walk(dir_path):
        for fname in files:
            fpath = os.path.join(root, fname)
            rel = os.path.relpath(fpath, dir_path)
            result[rel] = sha256_file(fpath)
    return result


# =============================================================================
# _build_file_diff 测试
# =============================================================================


class TestBuildFileDiff:
    def test_created_file(self):
        """before=None, after 有内容 → created。"""
        fd = _build_file_diff("new.yaml", None, "content")
        assert fd.status == "created"
        assert "+++ new.yaml" in fd.diff
        assert fd.before_preview == ""

    def test_deleted_file(self):
        """after=None, before 有内容 → deleted。"""
        fd = _build_file_diff("old.yaml", "content", None)
        assert fd.status == "deleted"
        assert "--- old.yaml" in fd.diff

    def test_modified_file(self):
        """before 和 after 不同 → modified。"""
        fd = _build_file_diff("file.yaml", "line1\nline2\n", "line1\nline3\n")
        assert fd.status == "modified"
        assert "-line2" in fd.diff
        assert "+line3" in fd.diff

    def test_no_change_file(self):
        """before 和 after 完全相同 → 返回 None（无变化，应被调用方跳过）。

        无变化的文件不应出现在确认框中，避免"修改 → 无文本差异"误导用户。
        """
        fd = _build_file_diff("unchanged.yaml", "same", "same")
        assert fd is None


# =============================================================================
# _shadow_copy 测试
# =============================================================================


class TestShadowCopy:
    def test_shadow_copy_preserves_content(self, tmp_path):
        """shadow_copy 后目标目录文件内容与源一致。"""
        ws = make_workspace(tmp_path)
        dst = str(tmp_path / "shadow")
        _shadow_copy(ws, dst)
        assert os.path.isfile(os.path.join(dst, "project.precis.yaml"))

    def test_shadow_copy_skips_precis_dir(self, tmp_path):
        """shadow_copy 跳过 .precis 目录。"""
        ws = make_workspace(tmp_path)
        precis_dir = os.path.join(ws, ".precis")
        os.makedirs(precis_dir)
        (pathlib.Path(precis_dir) / "tmp.log").write_text("ignored")

        dst = str(tmp_path / "shadow")
        _shadow_copy(ws, dst)
        assert not os.path.isdir(os.path.join(dst, ".precis"))


# =============================================================================
# compute_action_diff 测试
# =============================================================================


class TestComputeActionDiff:
    def test_diff_result_success_with_modified_files(self, tmp_path):
        """合法 action 产生 modified diff。"""
        ws = make_workspace(tmp_path)
        write_users_schema_with_email(ws)

        action = make_add_constraint_action("users", "email")

        result = compute_action_diff([action], ws)
        assert result.success is True
        assert len(result.files) > 0
        statuses = {f.status for f in result.files}
        assert "modified" in statuses

    def test_dry_run_does_not_touch_real_files(self, tmp_path):
        """dry-run 后真实文件内容不变。"""
        ws = make_workspace(tmp_path)
        schema_path = os.path.join(ws, "schemas", "users.schema.yaml")
        os.makedirs(os.path.dirname(schema_path), exist_ok=True)
        with open(schema_path, "w", encoding="utf-8") as f:
            f.write("name: users\ncolumns: []\n")

        before_hashes = sha256_dir(ws)

        action = make_add_constraint_action("users", "email")
        compute_action_diff([action], ws)

        after_hashes = sha256_dir(ws)
        assert before_hashes == after_hashes

    def test_dry_run_failure_propagates(self, tmp_path):
        """非法 action 导致 process_actions 失败，diff 结果 success=False。"""
        ws = make_workspace(tmp_path)
        bad_action = {
            "actionType": "UNKNOWN_TYPE",
            "constraintSpec": {},
        }
        result = compute_action_diff([bad_action], ws)
        assert result.success is False
        assert result.error is not None

    def test_temp_dir_cleaned(self, tmp_path):
        """compute_action_diff 后临时目录已清理。"""
        ws = make_workspace(tmp_path)
        schema_path = os.path.join(ws, "schemas", "users.schema.yaml")
        os.makedirs(os.path.dirname(schema_path), exist_ok=True)
        with open(schema_path, "w", encoding="utf-8") as f:
            f.write("name: users\ncolumns: []\n")

        existing_tempdirs = set(os.listdir(tempfile.gettempdir()))
        action = make_add_constraint_action("users", "email")
        compute_action_diff([action], ws)
        # 新的临时目录已被删除
        new_tempdirs = set(os.listdir(tempfile.gettempdir()))
        new_dirs = new_tempdirs - existing_tempdirs
        precis_dirs = {d for d in new_dirs if d.startswith("precis_dryrun_")}
        assert len(precis_dirs) == 0

    def test_summary_counts_correctly(self, tmp_path):
        """summary 中 modified 计数正确。"""
        ws = make_workspace(tmp_path)
        write_users_schema_with_email(ws)

        action = make_add_constraint_action("users", "email")
        result = compute_action_diff([action], ws)
        assert result.summary.get("modified", 0) > 0

    def test_frontend_instructions_collected(self, tmp_path):
        """dry-run 正确收集 frontend_instructions。"""
        ws = make_workspace(tmp_path)
        schema_path = os.path.join(ws, "schemas", "users.schema.yaml")
        os.makedirs(os.path.dirname(schema_path), exist_ok=True)
        with open(schema_path, "w", encoding="utf-8") as f:
            f.write("name: users\ncolumns: []\n")

        action = make_add_constraint_action("users", "email")
        result = compute_action_diff([action], ws)
        assert isinstance(result.frontend_instructions, list)


# =============================================================================
# P4 子批2: diff 完整性 #9 — dry-run 必须包含新建文件
# =============================================================================


class TestDiffIncludesCreatedFiles:
    """#9: 新增独立约束/Schema 时，diff 必须显示新建文件（旧逻辑只遍历已存在文件，遗漏新建）。"""

    def test_add_standalone_constraint_shows_created_file(self, tmp_path):
        """ADD 独立约束 → diff 应含 created 状态的约束文件（而非仅 manifest）。"""
        ws = make_workspace(tmp_path)
        # 准备 schema（约束将引用它）
        import yaml as _yaml

        schemas_dir = os.path.join(ws, "schemas")
        os.makedirs(schemas_dir, exist_ok=True)
        with open(os.path.join(schemas_dir, "users.schema.yaml"), "w", encoding="utf-8") as f:
            _yaml.safe_dump(
                {
                    "id": "sc_users",
                    "name": "users",
                    "columns": [{"id": "col_email", "name": "email", "type": "string"}],
                },
                f,
            )

        # ADD 独立约束（非内联）→ 会新建 constraints/*.constraint.yaml
        action = {
            "actionType": "ADD_CONSTRAINT_NODE",
            "constraintSpec": {
                "type": "Unique",
                "targetColumn": "email",
                "tableName": "users",
                "targetNodeId": "sc_users",
                "targetColumnId": "col_email",
                "isInline": False,
            },
        }
        result = compute_action_diff([action], ws)

        assert result.success is True
        # 关键：应有 created 状态的文件（新建的约束文件）
        statuses = {f.status for f in result.files}
        assert "created" in statuses, f"新建约束文件应出现在 diff（created），但 statuses={statuses}"
        # 约束文件路径应含 constraints/
        constraint_files = [f for f in result.files if "constraints" in f.path and f.status == "created"]
        assert len(constraint_files) >= 1, f"应至少有一个新建的约束文件，files={[f.path for f in result.files]}"
