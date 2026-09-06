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
@fileoverview ManualData 配置模块

功能概述:
- 定义 ManualData 节点的数据模型 (ManualDataFile)
- 用于持久化画布上的内联测试数据节点

架构设计:
- ManualDataFile 对应 manual_data/*.yaml 配置文件
- 在 manifest 中通过 ManualDataRef 引用
- 模板展开时，模板内 manualData 节点展开为 ManualDataFile
"""
