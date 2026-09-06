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
@fileoverview 文件处理设置类型定义模块

功能概述:
- 定义文件处理相关的配置选项
- 包括编码、分隔符

架构设计:
- 类型安全: 使用 Literal 限制可选值
- 默认值: 提供合理的默认配置
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class FileProcessingSettings(BaseModel):
    """@classdesc 文件处理设置

    定义如何读取数据文件。

    字段说明:
        - default_encoding: 文件字符编码，auto 表示自动检测
        - csv_delimiter: CSV 文件字段分隔符

    输入示例 (manifest.yaml):
        settings:
          file_processing:
            default_encoding: utf-8
            csv_delimiter: ";"

    输出示例:
        FileProcessingSettings(
            default_encoding="utf-8",
            csv_delimiter=";",
        )

    默认值:
        FileProcessingSettings(
            default_encoding="utf-8",
            csv_delimiter=",",
        )
    """

    default_encoding: Literal["utf-8", "gbk", "auto"] = Field("utf-8", description="读取文件时使用的字符编码")
    csv_delimiter: str = Field(",", description="CSV文件的字段分隔符")
