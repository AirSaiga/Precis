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
@fileoverview Manifest 常量定义模块

功能概述:
- 定义 manifest 相关的常量值
- 当前仅包含版本号常量
- 未来版本升级时在此添加新常量

架构设计:
- 版本号: V2_VERSION = 2
- 集中管理: 所有 manifest 相关常量统一放在此模块
- 未来版本升级时在此添加新常量

输入示例:
    从其他模块导入版本号常量
    from app.shared.core.project.manifest.types_parts.constants import V2_VERSION

输出示例:
    print(V2_VERSION)  # 输出: 2
"""

# 当前支持的 manifest 配置版本号
# 版本号用于区分不同版本的配置格式，确保兼容性
# 当配置格式发生重大变更时，需要增加版本号
V2_VERSION = 2
