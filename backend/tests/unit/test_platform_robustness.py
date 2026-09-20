# SPDX-License-Identifier: Apache-2.0
#
# Copyright 2026 Precis Team
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#    http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
"""@fileoverview 跨平台健壮性矩阵（失效模式清单 E 系列 + 资源阈值锁）

E1 Windows 中文路径 / E2 CRLF-LF 混合换行 / E3 长路径 / D1 分块阈值默认值锁定。
"""

from __future__ import annotations

from pathlib import Path

from app.shared.core.data_source.loaders.csv_loader import CSVLoader
from app.shared.core.data_source.specs.csv_source import CSVSourceSpec
from app.shared.services.validation.memory_monitor import DEFAULT_CHUNK_THRESHOLD_MB


def _load(path: Path):
    return CSVLoader(CSVSourceSpec(path=str(path), mode="relative")).load()


class TestCrossPlatform:
    """E 系列：跨平台路径与换行"""

    def test_e1_chinese_directory_and_filename(self, tmp_path):
        """E1: 中文目录 + 中文文件名 → 正常加载（Windows GBK 控制台与长路径之外最常见的本土坑）。"""
        d = tmp_path / "中文目录"
        d.mkdir()
        p = d / "数据文件.csv"
        p.write_text("id,name\n1,a\n", encoding="utf-8")
        df = _load(p)
        assert len(df) == 1

    def test_e2_crlf_lf_mixed_line_endings(self, tmp_path):
        """E2: CRLF/LF 混合换行 → 全部行正确解析（pandas 逐行容忍）。"""
        p = tmp_path / "crlf.csv"
        p.write_bytes(b"id,name\r\n1,a\r\n2,b\n3,c\r\n")
        df = _load(p)
        assert len(df) == 3
        assert df["name"].tolist() == ["a", "b", "c"]

    def test_e2_crlf_only(self, tmp_path):
        """E2: 纯 CRLF（Windows 记事本导出形态）。"""
        p = tmp_path / "crlf_only.csv"
        p.write_bytes(b"id,name\r\n1,a\r\n2,b\r\n")
        df = _load(p)
        assert len(df) == 2

    def test_e3_long_path_over_260(self, tmp_path):
        """E3: >260 字符路径 → 正常加载（Windows 需系统长路径开关，Linux 无限制）。"""
        long_dir = tmp_path / ("L" * 60) / ("L" * 60) / ("L" * 60) / ("L" * 60) / ("L" * 40)
        long_dir.mkdir(parents=True)
        p = long_dir / "data.csv"
        p.write_text("id,name\n1,a\n", encoding="utf-8")
        assert len(str(p)) > 260
        df = _load(p)
        assert len(df) == 1


class TestResourceThresholdLock:
    """D1: 分块阈值默认值锁定（常量被改应显式改本测试）"""

    def test_chunk_threshold_default_is_500_mb(self):
        """500MB 是分块加载的公开承诺（AGENTS/文档多处引用），常量漂移必须显式。"""
        assert DEFAULT_CHUNK_THRESHOLD_MB == 500
