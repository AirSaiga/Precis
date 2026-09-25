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
"""@fileoverview 项目概览提示词段（build_project_overview_section）单元测试

测试范围:
- parse_errors 渲染：损坏配置文件在系统提示词概览段可见（含字段级原因）
- 仅有坏文件、无可用资源的极端项目不返回空段
- 好项目零 parse_errors 时不渲染该小节（不破坏既有格式）
"""

from app.shared.services.llm.chat.chat_system_prompt import (
    _MAX_PARSE_ERRORS_IN_OVERVIEW_SECTION,
    build_project_overview_section,
)


def make_overview(**overrides) -> dict:
    """构造最小项目概览（默认干净项目），按需覆写字段。"""
    base = {
        "schemas": [],
        "constraints": [],
        "transforms": [],
        "regex_nodes": [],
        "settings": {},
        "parse_errors": [],
    }
    base.update(overrides)
    return base


class TestParseErrorsRendering:
    def test_parse_errors_rendered_with_path_and_field_reason(self):
        """坏文件以"路径: 错误摘要"形式渲染，字段级原因（source.mode）对 LLM 可见。"""
        section = build_project_overview_section(
            make_overview(
                parse_errors=[
                    {"path": "schemas/users.schema.yaml", "error": "严格校验失败: source.mode: Field required"}
                ]
            )
        )

        assert "解析失败的配置文件" in section
        assert "schemas/users.schema.yaml" in section
        assert "source.mode" in section
        assert "Field required" in section
        # 修复指引方向必须出现（读原文 + UPDATE_* 修复）
        assert "read_config_file" in section
        assert "UPDATE_" in section

    def test_parse_errors_only_project_still_renders_section(self):
        """仅有坏文件、无任何可用资源时概览段不整体消失（坏文件从视野里消失即诊断盲区）。"""
        section = build_project_overview_section(
            make_overview(parse_errors=[{"path": "schemas/bad.schema.yaml", "error": "yaml 语法错误"}])
        )

        assert section != ""
        assert "解析失败的配置文件" in section
        assert "schemas/bad.schema.yaml" in section

    def test_clean_project_omits_parse_errors_section(self):
        """好项目零 parse_errors 时不渲染该小节，既有概览格式不变。"""
        section = build_project_overview_section(
            make_overview(schemas=[{"id": "users", "name": "users", "columns": [{"id": "c1", "name": "email"}]}])
        )

        assert "解析失败的配置文件" not in section
        assert "users" in section

    def test_parse_error_list_capped_with_remaining_count(self):
        """超上限的坏文件清单折叠为计数，不在系统提示词里无限膨胀。"""
        many = [{"path": f"schemas/bad{i}.schema.yaml", "error": "严格校验失败: x: Field required"} for i in range(15)]

        section = build_project_overview_section(make_overview(parse_errors=many))

        # 前 N 个逐条列出，其余折叠为计数
        listed = sum(1 for i in range(15) if f"schemas/bad{i}.schema.yaml" in section)
        assert listed == _MAX_PARSE_ERRORS_IN_OVERVIEW_SECTION
        assert f"另有 {15 - _MAX_PARSE_ERRORS_IN_OVERVIEW_SECTION} 个" in section
