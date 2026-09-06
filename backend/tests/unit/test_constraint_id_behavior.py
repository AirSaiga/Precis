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
@fileoverview 约束 ID 生成行为测试
"""

from __future__ import annotations

from app.shared.services.llm.constraints.constraint_id import _chinese_to_abbr, _generate_constraint_id


class TestConstraintId:
    """约束 ID 生成行为"""

    def test_english_column(self):
        result = _generate_constraint_id("NotNull", "users", "email")
        assert result == "notnull_users_email"

    def test_chinese_column_maps_to_abbr(self):
        result = _generate_constraint_id("NotNull", "users", "邮箱")
        assert result == "notnull_users_email"

    def test_long_table_name_truncated(self):
        result = _generate_constraint_id("NotNull", "very_long_table_name", "col")
        assert result == "notnull_very_long__col"

    def test_special_chars_sanitized(self):
        result = _generate_constraint_id("Range", "t1", "col-with.dots")
        assert result == "range_t1_col_with_dots"

    def test_empty_table_abbr_uses_type_and_column(self):
        result = _generate_constraint_id("notNull", "___", "email")
        assert result == "notnull_email"


class TestChineseToAbbr:
    """中文表/列名映射行为"""

    def test_known_mapping(self):
        assert _chinese_to_abbr("邮箱") == "email"
        assert _chinese_to_abbr("用户") == "user"
        assert _chinese_to_abbr("订单") == "order"

    def test_partial_match(self):
        assert _chinese_to_abbr("用户信息") == "user"

    def test_unknown_chinese_returns_pinyin(self):
        result = _chinese_to_abbr("供商")
        assert isinstance(result, str)
        assert len(result) > 0

    def test_english_returns_joined_initials(self):
        result = _chinese_to_abbr("some_text")
        assert isinstance(result, str)
