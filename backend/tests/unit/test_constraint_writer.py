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
@fileoverview 约束写入模块单元测试

测试 save_constraint 函数。
"""

import os
import tempfile

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
