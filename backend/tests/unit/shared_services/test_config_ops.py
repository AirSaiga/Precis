"""shared_services.config_ops 单元测试。"""

from __future__ import annotations

from app.cli.shared_services.config_ops import (
    check_yaml_syntax,
    find_config_file,
    get_by_dotpath,
    parse_config_value,
    set_by_dotpath,
)


def test_get_by_dotpath_nested():
    assert get_by_dotpath({"a": {"b": 1}}, "a.b") == (True, 1)
    assert get_by_dotpath({"a": {"b": 1}}, "a.c") == (False, None)
    assert get_by_dotpath({}, "x") == (False, None)


def test_set_by_dotpath_creates_intermediate():
    new = set_by_dotpath({}, "a.b.c", 1)
    assert new == {"a": {"b": {"c": 1}}}
    # 不改原 dict
    orig = {"x": 1}
    set_by_dotpath(orig, "y", 2)
    assert orig == {"x": 1}


def test_parse_config_value_types():
    assert parse_config_value("true")[1] is True
    assert parse_config_value("false")[1] is False
    assert parse_config_value("null")[1] is None
    assert parse_config_value("123")[1] == 123
    assert parse_config_value("1.5")[1] == 1.5
    assert parse_config_value('"hello"')[1] == "hello"
    assert parse_config_value("[1, 2]")[1] == [1, 2]


def test_check_yaml_syntax_detects_error():
    result = check_yaml_syntax("foo: bar\nbaz: : bad", "test.yaml")
    assert result.valid is False
    assert result.file == "test.yaml"


def test_check_yaml_syntax_valid():
    result = check_yaml_syntax("a: 1\nb: 2", "ok.yaml")
    assert result.valid is True


def test_find_config_file_allows_double_dot_inside_filename(tmp_path):
    """回归：`..` 检查按路径段而非子串，"my..data.yaml" 不应被误判为穿越。"""
    (tmp_path / "my..data.yaml").write_text("a: 1\n", encoding="utf-8")
    result = find_config_file(str(tmp_path), "my..data.yaml")
    assert result is not None
    assert result.endswith("my..data.yaml")


def test_find_config_file_still_rejects_parent_dir_traversal(tmp_path):
    """真正的父目录穿越（路径段 ".."）仍被拒绝。"""
    sub = tmp_path / "sub"
    sub.mkdir()
    (sub / "secret.yaml").write_text("x: 1\n", encoding="utf-8")
    assert find_config_file(str(tmp_path), "../secret.yaml") is None
    assert find_config_file(str(tmp_path), "a/../../b.yaml") is None
