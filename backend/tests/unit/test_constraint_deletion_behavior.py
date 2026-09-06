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
