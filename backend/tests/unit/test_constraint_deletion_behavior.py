# SPDX-License-Identifier: Apache-2.0
#
# Copyright 2026 Precis Team
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
"""@fileoverview 约束文件删除行为测试（constraint_deletion 直连）

delete_constraint_file 接收完整 constraintSpec：显式 constraintId 优先，
未命中时按语义引用（表 + 列 + 类型）磁盘搜索——对存量语义 ID 文件与新
UUID 文件同样适用。端到端（manifest 清理/信封）见
test_constraint_uuid_and_semantics.py。
"""

from __future__ import annotations

import yaml

from app.shared.services.llm.constraints.constraint_deletion import delete_constraint_file


def _write_constraint_file(tmp_path, constraint_id: str, *, table_id: str = "users", column_id: str = "c1") -> None:
    constraints_dir = tmp_path / "constraints"
    constraints_dir.mkdir(exist_ok=True)
    (constraints_dir / f"{constraint_id}.constraint.yaml").write_text(
        yaml.safe_dump(
            {
                "version": 2,
                "id": constraint_id,
                "type": "NotNull",
                "enabled": True,
                "refs": {"table_id": table_id, "column_id": column_id},
            }
        ),
        encoding="utf-8",
    )


class TestDeleteConstraintFile:
    """delete_constraint_file 行为"""

    def test_deletes_by_semantic_reference(self, tmp_path):
        """未传 id：按语义引用（表+列+类型）匹配文件内容删除，返回真实 id。"""
        _write_constraint_file(tmp_path, "notnull_users_email")

        success, msg = delete_constraint_file(
            {"type": "NotNull", "tableName": "users", "targetColumn": "email", "targetColumnId": "c1"},
            str(tmp_path),
        )
        assert success is True
        assert msg == "notnull_users_email"
        assert not (tmp_path / "constraints" / "notnull_users_email.constraint.yaml").exists()

    def test_deletes_by_explicit_constraint_id(self, tmp_path):
        """显式 constraintId 优先：按内容 id/文件名定位删除。"""
        _write_constraint_file(tmp_path, "range_1f0c8e52-9d1e-4f0a-9b3e-6a2f5c8d7e90", column_id="c1")

        success, msg = delete_constraint_file(
            {
                "type": "Range",
                "tableName": "users",
                "targetColumn": "amount",
                "constraintId": "range_1f0c8e52-9d1e-4f0a-9b3e-6a2f5c8d7e90",
            },
            str(tmp_path),
        )
        assert success is True
        assert msg == "range_1f0c8e52-9d1e-4f0a-9b3e-6a2f5c8d7e90"
        assert (
            not (tmp_path / "constraints")
            .joinpath("range_1f0c8e52-9d1e-4f0a-9b3e-6a2f5c8d7e90.constraint.yaml")
            .exists()
        )

    def test_returns_false_when_file_missing(self, tmp_path):
        constraints_dir = tmp_path / "constraints"
        constraints_dir.mkdir()

        success, msg = delete_constraint_file(
            {"type": "NotNull", "tableName": "nonexistent", "targetColumn": "col"}, str(tmp_path)
        )
        assert success is False
        assert "不存在" in msg

    def test_rejects_traversal_constraint_id(self, tmp_path):
        success, msg = delete_constraint_file(
            {"type": "NotNull", "tableName": "users", "targetColumn": "email", "constraintId": "../evil"},
            str(tmp_path),
        )
        assert success is False
        assert "非法" in msg
