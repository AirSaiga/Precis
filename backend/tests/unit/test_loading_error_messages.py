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
"""@fileoverview 加载期错误友好文案生成单元测试

覆盖 _resource_label 的中文标签映射（含 ManualData 条目）
与各错误消息生成函数对该标签的使用。
"""

from __future__ import annotations

from app.shared.core.project.loader.loader_parts.loading_error_messages import (
    _resource_label,
    file_not_found_error,
    parse_error,
    path_validation_error,
    template_expansion_error,
)


class TestResourceLabels:
    def test_manual_data_label_is_chinese(self):
        """回归：ManualData 此前缺条目，文案里直接露英文类型名。"""
        assert _resource_label("ManualData") == "手动数据"
        assert _resource_label("manualdata") == "手动数据"

    def test_known_labels(self):
        assert _resource_label("Schema") == "数据表定义"
        assert _resource_label("Constraint") == "约束规则"
        assert _resource_label("Regex") == "正则规则"
        assert _resource_label("Transform") == "数据转换"
        assert _resource_label("Template") == "模板"

    def test_unknown_label_falls_back_to_original(self):
        assert _resource_label("UnknownKind") == "UnknownKind"
        assert _resource_label("") == "配置文件"


class TestMessagesUseManualDataLabel:
    def test_file_not_found_error_uses_manual_data_label(self):
        result = file_not_found_error("ManualData", "md_1", "/proj/manual_data/md_1.manual.yaml")
        assert "手动数据" in result["title"]
        assert result["message_params"]["resourceLabel"] == "手动数据"

    def test_parse_error_uses_manual_data_label(self):
        result = parse_error("ManualData", "md_1", "/proj/md_1.manual.yaml", ValueError("bad field"))
        assert "手动数据" in result["title"]

    def test_path_validation_error_uses_manual_data_label(self):
        result = path_validation_error("ManualData", "md_1", "escapes root")
        assert "手动数据" in result["title"]


class TestInvolvedEntities:
    """加载期错误的 context.involved：单一文件实体（role=file，文件无画布节点 → 不可导航）。"""

    def _assert_file_entity(self, entity: dict, kind: str, ref_id: str, path: str) -> None:
        assert entity["kind"] == kind
        assert entity["id"] == ref_id
        assert entity["path"] == path
        # label 取路径 basename
        assert entity["label"] == path.rsplit("/", 1)[-1]
        assert entity["navigable"] is False
        assert entity["role"] == "file"

    def test_file_not_found_error_carries_file_entity(self):
        result = file_not_found_error("Schema", "s1", "/proj/schemas/s1.schema.yaml")
        involved = result["context"]["involved"]
        assert len(involved) == 1
        self._assert_file_entity(involved[0], "schema", "s1", "/proj/schemas/s1.schema.yaml")

    def test_parse_error_carries_file_entity(self):
        result = parse_error("Constraint", "c1", "/proj/constraints/c1.constraint.yaml", ValueError("bad"))
        involved = result["context"]["involved"]
        assert len(involved) == 1
        self._assert_file_entity(involved[0], "constraint", "c1", "/proj/constraints/c1.constraint.yaml")

    def test_path_validation_error_carries_file_entity(self):
        """路径校验失败也给文件实体（path 越界目标仍展示，"打开文件"失败是既有行为）。"""
        result = path_validation_error("ManualData", "md_1", "escapes root", "/etc/passwd")
        involved = result["context"]["involved"]
        assert len(involved) == 1
        # ManualData 归一为 manual_data（与 id 检查 kind 一致）
        self._assert_file_entity(involved[0], "manual_data", "md_1", "/etc/passwd")

    def test_template_expansion_error_carries_file_entity(self):
        result = template_expansion_error("tpl_1", ValueError("boom"), "/proj/project.precis.yaml")
        involved = result["context"]["involved"]
        assert len(involved) == 1
        self._assert_file_entity(involved[0], "template", "tpl_1", "/proj/project.precis.yaml")
