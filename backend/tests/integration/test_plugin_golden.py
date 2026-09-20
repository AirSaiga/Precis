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
"""@fileoverview 通用 harness 集成 golden 演练 pytest 包装（P3-1 + 通用化守卫）

复用 scripts/plugin_golden_test 的四项检查，使 `python -m pytest` 与 CI
backend job 无需额外步骤即可覆盖（CI 另有显式脚本步骤双保险）。
"""

from __future__ import annotations

import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND_ROOT / "scripts"))

from plugin_golden_test import (  # noqa: E402
    check_contract_doc,
    check_golden_validation,
    check_harness_neutrality,
    check_plugin_manifests,
)


def test_plugin_golden_validation():
    """v2-format.md 示例配置 → validate 预期错误集（文档漂移即红）。"""
    result = check_golden_validation()
    assert result["errors"] == 3
    assert result["summary"]["constraints_total"] == 4
    assert result["loading_warnings"] == 0


def test_plugin_dual_manifest_consistency():
    """双 manifest（integrations 根 + 仓库根垫片）字段一致且引用路径存在。"""
    result = check_plugin_manifests()
    assert result["name"] == "precis"


def test_contract_doc_present_and_version_matches():
    """契约文档入库且 schema_version 与实现一致。"""
    result = check_contract_doc()
    assert result["json_schema_version"] == 1


def test_shared_content_harness_neutral():
    """共享 skill/命令文件无单一 harness 专有语法（跨 harness 可用性守卫）。"""
    result = check_harness_neutrality()
    assert result["checked_files"] >= 5
