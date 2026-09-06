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
@fileoverview 建议工具行为测试
"""

from __future__ import annotations

from app.shared.services.llm.suggestion_utils import (
    normalize_constraint_type,
    suggest_constraints_for_type,
    suggest_similar_column,
    suggest_similar_constraint_type,
    suggest_similar_table,
)


class TestSuggestionUtils:
    """建议工具行为"""

    def test_normalize_constraint_type(self):
        assert normalize_constraint_type("not_null") == "NotNull"
        assert normalize_constraint_type("regex") == "Scripted"
        assert normalize_constraint_type("Unknown") == "Unknown"

    def test_suggest_similar_table(self):
        schema = {"tables": {"users": {}}, "table_name_to_id": {"user": "users"}}
        result = suggest_similar_table("user", schema)
        assert "users" in result

    def test_suggest_similar_column(self):
        table_info = {"columns": {"c1": {"name": "email"}, "c2": {"name": "phone"}}}
        result = suggest_similar_column("em", table_info)
        assert "email" in result

    def test_suggest_similar_constraint_type(self):
        result = suggest_similar_constraint_type("notnull")
        assert "NotNull" in result

    def test_suggest_constraints_for_type(self):
        assert "NotNull" in suggest_constraints_for_type("string")
        assert "Range" in suggest_constraints_for_type("integer")
        assert "DateLogic" in suggest_constraints_for_type("date")
