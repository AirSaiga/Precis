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
"""shared_services.config_ops 单元测试。"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

from app.cli.shared_services.config_ops import (
    MATCH_BASENAME,
    MATCH_DIRECT,
    MATCH_EXACT,
    check_yaml_syntax,
    find_config_file,
    get_by_dotpath,
    parse_config_value,
    resolve_config_file,
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


def test_resolve_direct_path_hit(tmp_path: Path) -> None:
    """直接路径命中：kind 为 MATCH_DIRECT。"""
    (tmp_path / "a.yaml").write_text("a: 1\n", encoding="utf-8")
    path, kind = resolve_config_file(str(tmp_path), "a.yaml")
    assert path is not None and path.endswith("a.yaml")
    assert kind == MATCH_DIRECT


def test_resolve_requested_path_not_shadowed_by_same_name_elsewhere(tmp_path: Path) -> None:
    """同名文件并存时用户请求的路径优先：输入 "z_sub/x.yaml" 命中 z_sub 下的文件，
    不被先遍历到的 a_sub/x.yaml（basename 同名）抢走。"""
    (tmp_path / "a_sub").mkdir()
    (tmp_path / "z_sub").mkdir()
    (tmp_path / "a_sub" / "x.yaml").write_text("a: 1\n", encoding="utf-8")
    (tmp_path / "z_sub" / "x.yaml").write_text("b: 2\n", encoding="utf-8")

    path, kind = resolve_config_file(str(tmp_path), os.path.join("z_sub", "x.yaml"))

    assert kind in (MATCH_DIRECT, MATCH_EXACT)
    assert path is not None and path.endswith(os.path.join("z_sub", "x.yaml"))


@pytest.mark.skipif(sys.platform == "win32", reason="依赖大小写敏感文件系统构造 direct miss + exact 命中")
def test_resolve_exact_match_wins_over_basename_on_case_sensitive_fs(tmp_path: Path) -> None:
    """大小写敏感 FS 上的排序回归：direct miss 后精确相对路径命中先于 basename 回退。

    输入 "SUB/x.yaml"（大写目录名），实际文件在 sub/x.yaml；a_sub/x.yaml 同名
    且遍历顺序更早。旧实现 basename 先匹配会返回 a_sub/x.yaml；修复后 exact
    整轮优先，返回 sub/x.yaml。
    """
    (tmp_path / "a_sub").mkdir()
    (tmp_path / "sub").mkdir()
    (tmp_path / "a_sub" / "x.yaml").write_text("a: 1\n", encoding="utf-8")
    (tmp_path / "sub" / "x.yaml").write_text("b: 2\n", encoding="utf-8")

    path, kind = resolve_config_file(str(tmp_path), os.path.join("SUB", "x.yaml"))

    assert kind == MATCH_EXACT
    assert path is not None and path.endswith(os.path.join("sub", "x.yaml"))


def test_resolve_basename_fallback_when_exact_missing(tmp_path: Path) -> None:
    """目录名手误（schemas/x.yaml 实际只有 regex/x.yaml）：模糊回退命中 regex 下文件，
    但 kind 必须标记为 MATCH_BASENAME 供调用方披露实际路径。"""
    (tmp_path / "regex").mkdir()
    (tmp_path / "regex" / "x.yaml").write_text("x: 1\n", encoding="utf-8")

    path, kind = resolve_config_file(str(tmp_path), os.path.join("schemas", "x.yaml"))

    assert kind == MATCH_BASENAME
    assert path is not None and path.endswith(os.path.join("regex", "x.yaml"))


def test_resolve_not_found_returns_none_pair(tmp_path: Path) -> None:
    """文件不存在时返回 (None, None)。"""
    assert resolve_config_file(str(tmp_path), "missing.yaml") == (None, None)


def test_resolve_still_rejects_parent_dir_traversal(tmp_path: Path) -> None:
    """穿越防护对 resolve_config_file 同样生效。"""
    sub = tmp_path / "sub"
    sub.mkdir()
    (sub / "secret.yaml").write_text("x: 1\n", encoding="utf-8")
    assert resolve_config_file(str(tmp_path), "../secret.yaml") == (None, None)
