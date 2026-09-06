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
@fileoverview 报告器实现统一导出模块

功能概述:
- 聚合导出所有内置报告器实现（本地文件、邮件、企业微信、飞书、钉钉）
- 提供 Reporter 抽象基类统一入口

架构设计:
- 注册表模式: 各报告器实现继承自 Reporter 基类
- 统一导出: 通过 __all__ 控制对外可见的报告器列表
- 便于扩展: 新增报告器时只需在此添加导入和 __all__ 列表

输入示例:
    从外部导入所需的报告器:
    from backend.app.shared.core.reporter.reporters import (
        Reporter,           # 抽象基类，用于自定义报告器
        LocalFileReporter,  # 本地文件报告器
        EmailReporter,      # 邮件报告器
        WeComAppReporter,   # 企业微信报告器
        FeishuReporter,     # 飞书报告器
        DingTalkAppReporter # 钉钉报告器
    )

输出示例:
    导出的报告器列表:
    __all__ = [
        "Reporter",
        "LocalFileReporter",
        "EmailReporter",
        "WeComAppReporter",
        "FeishuReporter",
        "DingTalkAppReporter",
    ]
"""

from .base import Reporter
from .dingtalk_app_reporter import DingTalkAppReporter
from .email_reporter import EmailReporter
from .feishu_app_reporter import FeishuReporter
from .local_file_reporter import LocalFileReporter
from .wecom_app_reporter import WeComAppReporter

__all__ = [
    "Reporter",
    "LocalFileReporter",
    "EmailReporter",
    "WeComAppReporter",
    "FeishuReporter",
    "DingTalkAppReporter",
]
