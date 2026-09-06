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
# backend/app/cli/__main__.py
"""
@fileoverview CLI 入口启动模块

功能概述:
- 作为 python -m app.cli 的入口点启动交互式 CLI
- 委托给 shell.main.main 执行主循环
"""

import sys

from app.cli.shell.main import main

if __name__ == "__main__":
    sys.exit(main())
