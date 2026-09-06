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
@fileoverview AI 服务统一导出模块

功能概述:
- 向后兼容地暴露配置生成器核心接口
- 将 llm.config_generator 的公共 API 聚合到 app.shared.services.ai 命名空间

架构设计:
- 作为兼容层存在，避免历史调用方修改导入路径
- 通过 __all__ 明确控制对外暴露的符号

输入示例:
    from app.shared.services.ai import generate_full_config_v2, GenerateOptions

输出示例:
    可直接调用 generate_full_config_v2(options) 生成 V2 项目配置
"""

from app.shared.services.llm.config_generator import (
    V2_MANIFEST_FILENAME,
    GenerateOptions,
    ProfilingOptions,
    expand_data_input_paths,
    generate_full_config_v2,
)

__all__ = [
    "ProfilingOptions",
    "GenerateOptions",
    "generate_full_config_v2",
    "expand_data_input_paths",
    "V2_MANIFEST_FILENAME",
]
