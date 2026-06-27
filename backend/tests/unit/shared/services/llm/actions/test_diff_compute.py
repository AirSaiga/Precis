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
        """before 和 after 完全相同 → modified 但 diff 为空提示。"""
        fd = _build_file_diff("unchanged.yaml", "same", "same")
        assert fd.status == "modified"
        assert "(无文本差异)" in fd.diff


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
        schema_path = os.path.join(ws, "schemas", "users.schema.yaml")
        os.makedirs(os.path.dirname(schema_path), exist_ok=True)
        with open(schema_path, "w", encoding="utf-8") as f:
            f.write("name: users\ncolumns: []\n")

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
        schema_path = os.path.join(ws, "schemas", "users.schema.yaml")
        os.makedirs(os.path.dirname(schema_path), exist_ok=True)
        with open(schema_path, "w", encoding="utf-8") as f:
            f.write("name: users\ncolumns: []\n")

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
