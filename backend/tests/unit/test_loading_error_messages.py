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

from pathlib import Path

from app.shared.core.project.loader.loader_parts.loading_error_messages import (
    _resource_label,
    file_not_found_error,
    parse_error,
    path_validation_error,
    template_expansion_error,
)

_REPO_ROOT = Path(__file__).resolve().parents[3]


def _extract_block(source: str, header: str) -> str | None:
    """从 TS 源文本提取 header（如 'load: {'）对应的花括号块内容。"""
    idx = source.find(header)
    if idx == -1:
        return None
    start = source.find("{", idx)
    depth = 0
    for i in range(start, len(source)):
        if source[i] == "{":
            depth += 1
        elif source[i] == "}":
            depth -= 1
            if depth == 0:
                return source[start + 1 : i]
    return None


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


class TestLoadingErrorI18nKeysRegistered:
    """H14 守卫：后端 LoadingError 的 *_key 必须在前端 zh/en 双侧 locale 注册。

    前端 audit:i18n 只扫 t() 引用，看不到后端产生的 key——此处补契约测试，
    防止新增 LoadingError 消息函数后 locale 漏注册导致前端静默回退中文 fallback。
    """

    def test_all_load_keys_registered_in_both_locales(self):
        import inspect
        import re

        from app.shared.core.project.loader.loader_parts import loading_error_messages as lem

        locale_files = {
            "zh": _REPO_ROOT / "frontend" / "src" / "i18n" / "locales" / "zh-CN" / "inspection.ts",
            "en": _REPO_ROOT / "frontend" / "src" / "i18n" / "locales" / "en-US" / "inspection.ts",
        }
        sources = {lang: p.read_text(encoding="utf-8") for lang, p in locale_files.items()}

        key_pattern = re.compile(r"inspection\.issues\.load\.[A-Za-z]+\.[a-zA-Z]+")
        keys: set[str] = set()
        for _name, fn in inspect.getmembers(lem, inspect.isfunction):
            if fn.__module__ != lem.__name__:
                continue
            keys.update(key_pattern.findall(inspect.getsource(fn)))
        assert keys, "应至少扫描到一个 load 域 i18n key"

        missing: list[str] = []
        for key in sorted(keys):
            _ns, _domain, _load, section, leaf = key.split(".")
            for lang, source in sources.items():
                load_block = _extract_block(source, "load: {")
                assert load_block is not None, f"{lang} locale 缺少 load 命名空间"
                section_block = _extract_block(load_block, f"{section}: {{")
                if section_block is None or not re.search(rf"\b{leaf}\s*:", section_block):
                    missing.append(f"{lang}: {key}")
        assert not missing, f"后端 LoadingError key 未双侧注册 locale: {missing}"
