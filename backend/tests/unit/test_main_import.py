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
"""
@fileoverview main.py 导入副作用测试

验证导入 app.api.main 不会在 sys.path 中新增项目根目录，
确保 main.py 顶层的 sys.path hack 已被移除。
"""

import sys


class TestMainImport:
    def test_import_main_does_not_mutate_sys_path(self):
        """导入 main 模块前后 sys.path 不应发生变化。"""
        before = list(sys.path)

        # 重新导入以确保测试覆盖当前文件状态
        import importlib

        import app.api.main

        importlib.reload(app.api.main)

        after = list(sys.path)
        assert after == before
