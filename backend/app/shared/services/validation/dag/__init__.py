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
@fileoverview DAG 执行包

导出:
- build_transform_dag: 构建 Transform DAG
- topological_sort: 拓扑排序
- execute_transform_dag: 执行 DAG
"""

from .builder import ExecutionDAG, build_execution_dag, build_transform_dag
from .executor import execute_transform_dag
from .sorter import topological_sort

__all__ = [
    "ExecutionDAG",
    "build_execution_dag",
    "build_transform_dag",
    "topological_sort",
    "execute_transform_dag",
]
