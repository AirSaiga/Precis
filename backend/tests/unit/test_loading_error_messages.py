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
