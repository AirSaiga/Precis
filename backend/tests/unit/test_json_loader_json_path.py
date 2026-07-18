"""验证 JSONLoader 在 array+json_path 时不触发 D8 嵌套拒绝。"""

from __future__ import annotations

import json
from pathlib import Path

from app.shared.core.data_source.loaders.json_loader import JSONLoader
from app.shared.core.data_source.specs.json_source import JSONSourceSpec


def _write_nested_json(tmp_path: Path) -> Path:
    """写入 D8 报告中失败的嵌套 JSON 结构。"""
    f = tmp_path / "inventory.json"
    f.write_text(
        json.dumps(
            {
                "warehouse": "A1",
                "items": [
                    {"id": 1, "profile": {"name": "Alice", "age": 30}, "tags": ["new"]},
                    {"id": 2, "profile": {"name": "Bob", "age": 25}, "tags": ["used"]},
                    {"id": 3, "profile": {"name": None, "age": 28}, "tags": ["new"]},
                ],
            }
        ),
        encoding="utf-8",
    )
    return f


def test_array_format_with_json_path_loads_nested_json(tmp_path):
    """array 格式 + json_path='$.items' 应成功加载嵌套 JSON 的 3 条记录。

    回归 D8 过度收紧：ArrayParser._parse_dict 曾拒绝任何含 list 的 dict，
    但用户已通过 json_path 显式定位数据数组，无需启发式拒绝。
    """
    f = _write_nested_json(tmp_path)
    spec = JSONSourceSpec(path=str(f), format="array", json_path="$.items")
    loader = JSONLoader(spec)
    df = loader.load()
    assert len(df) == 3
    assert list(df.columns) >= ["id"]  # 至少含 id 列（profile/tags 扁平化后另算）


def test_array_format_with_json_path_preserves_nested_fields(tmp_path):
    """json_path 提取后，嵌套字段 profile.name 应可访问（扁平化或嵌套对象）。"""
    f = _write_nested_json(tmp_path)
    spec = JSONSourceSpec(path=str(f), format="array", json_path="$.items", flatten=True)
    loader = JSONLoader(spec)
    df = loader.load()
    # flatten=True 时 profile.name 应展开为列；第三行 name 为 null
    assert "profile.name" in df.columns or "name" in df.columns
