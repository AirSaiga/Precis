"""config init 模板回归测试。

历史缺陷：模板填充用 str.format，正则模板里的量词 {2,} 被当作替换字段，
导致 `config init pattern` 100% 抛 KeyError('2,')；PROJECT_TEMPLATE 为 V1 形态，
产物缺 version: 2 无法按 V2 项目加载。修复后填充改为字符串 replace，
PROJECT_TEMPLATE 为合法 V2 manifest。
"""

from __future__ import annotations

import yaml

from app.cli.shell.commands.config.base import (
    CONSTRAINT_TEMPLATE,
    PATTERNS_TEMPLATE,
    PROJECT_TEMPLATE,
)
from app.shared.core.project.manifest.types import ProjectManifestV2


class TestConfigInitTemplates:
    def test_patterns_template_fill_does_not_crash_on_regex_braces(self):
        """正则模板含 {2,} 等花括号字面量，replace 填充不得抛 KeyError 且保留正则原文"""
        content = PATTERNS_TEMPLATE.replace("{project_name}", "demo")
        assert "{project_name}" not in content
        assert "{2,}" in content  # 正则量词原样保留

    def test_constraint_template_fill(self):
        content = CONSTRAINT_TEMPLATE.replace("{project_name}", "demo")
        assert "{project_name}" not in content

    def test_project_template_produces_valid_v2_manifest(self):
        """PROJECT 模板填充后必须是合法 V2 manifest（version: 2 + project.id/name）"""
        content = PROJECT_TEMPLATE.replace("{project_name}", "demo")
        data = yaml.safe_load(content)
        manifest = ProjectManifestV2.model_validate(data)
        assert manifest.version == 2
        assert manifest.project.id == "demo"
        assert manifest.project.name == "demo"
