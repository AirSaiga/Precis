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
"""@fileoverview Precis AI 能力评估套件包

三个能力套件：generation（nl→V2 生成）/ migration（旧格式→V2 迁移）/ agent（对话工具调用与变更集）。
入口见 evals/run_evals.py。
"""

from .common import EvalTask, SuiteReport, TaskReport, probe_provider

__all__ = ["EvalTask", "SuiteReport", "TaskReport", "probe_provider"]
