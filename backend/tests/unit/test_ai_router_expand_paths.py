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
"""测试 /ai/utils/expand-paths 端点的 header 路径还原与展开行为。

背景：前端 httpClient 出口对含非 ASCII 的项目路径统一 percent-encode（GUI
契约），本端点曾直用原始 header 作相对路径 base，中文项目下相对路径全 miss、
静默返回空列表。修复后入口经 _decode_header_path 还原再解析。
"""

from __future__ import annotations

import os

from app.api.routers.ai.utils import expand_paths


def _make_project(tmp_path, name: str) -> str:
    project_dir = tmp_path / name
    (project_dir / "data").mkdir(parents=True)
    (project_dir / "data" / "users.csv").write_text("id\n1\n", encoding="utf-8")
    return str(project_dir)


class TestExpandPathsHeaderDecode:
    def test_percent_encoded_chinese_header_resolves_relative(self, tmp_path):
        """GUI 契约：percent-encode 的中文项目根下，相对路径正确解析展开"""
        from urllib.parse import quote

        project = _make_project(tmp_path, "测试项目")
        encoded = quote(project, safe="!*'()")

        result = expand_paths(["data/"], x_project_config_path=encoded)

        assert result == [os.path.join(project, "data", "users.csv")]

    def test_utf8_raw_bytes_header_resolves_relative(self, tmp_path):
        """TUI 契约：UTF-8 原始字节（经 ASGI latin-1 解码后的乱码）同样还原解析"""
        project = _make_project(tmp_path, "测试项目")
        mojibake = project.encode("utf-8").decode("latin-1")

        result = expand_paths(["data/"], x_project_config_path=mojibake)

        assert result == [os.path.join(project, "data", "users.csv")]

    def test_plain_ascii_header_unchanged(self, tmp_path):
        """纯 ASCII header 原样使用（解码为恒等变换）"""
        project = _make_project(tmp_path, "plain-project")

        result = expand_paths(["data/users.csv"], x_project_config_path=project)

        assert result == [os.path.join(project, "data", "users.csv")]

    def test_none_header_absolute_path_still_works(self, tmp_path):
        """无 header 时绝对路径照常展开（可选语义不回归）"""
        project = _make_project(tmp_path, "no-header")
        absolute = os.path.join(project, "data", "users.csv")

        result = expand_paths([absolute], x_project_config_path=None)

        assert result == [absolute]
