"""@fileoverview 本地文件报告器模块

功能概述:
- 将数据验证错误报告以 JSON 格式写入本地文件系统
- 支持自动创建日志目录和时间戳命名文件
- 每个报告生成独立的文件，避免覆盖历史记录

架构设计:
- 继承 Reporter 抽象基类，实现 configure() 和 report() 方法
- 目录管理: configure() 自动创建不存在的日志目录
- 时间戳命名: 使用 datetime.now().strftime("%Y%m%d_%H%M%S") 生成唯一文件名
- UTF-8 编码: 确保中文字符正确存储
- 格式化输出: indent=2 使 JSON 文件便于人工阅读

输入示例:
    配置参数:
    {"log_dir": "./logs"}

    错误数据:
    [
        {"error_type": "TypeValidationError", "row_index": 2, "column": "price", "value": "abc"},
        {"error_type": "NotNullViolation", "row_index": 5, "column": "email"}
    ]

输出示例:
    生成的日志文件: ./logs/error_report_20240115_143052.json

    文件内容:
    [
      {
        "error_type": "TypeValidationError",
        "row_index": 2,
        "column": "price",
        "value": "abc"
      },
      {
        "error_type": "NotNullViolation",
        "row_index": 5,
        "column": "email"
      }
    ]

    控制台输出:
    [LocalFileReporter] 日志目录已创建: ./logs
    [LocalFileReporter] ✓ 成功将错误报告写入本地日志: ./logs/error_report_20240115_143052.json
"""

import json
import os
from datetime import datetime
from typing import Any

from .base import Reporter


class LocalFileReporter(Reporter):
    """
    @classdesc 本地文件报告器 - 将错误报告写入本地文件系统

    该报告器将数据验证错误以 JSON 格式写入本地日志目录。
    适用于需要本地持久化错误日志的场景，或作为邮件报告的补充方案。

    属性说明：
        log_dir: 日志文件存放的目录路径
                 可以是相对路径或绝对路径

    功能特点：
        - 自动创建日志目录（如果不存在）
        - 每个报告生成独立的时间戳文件名，避免覆盖
        - JSON 格式存储，便于程序化处理
        - UTF-8 编码，支持中文错误信息

    使用示例：
        reporter = LocalFileReporter()
        if reporter.configure(log_dir='./logs/errors'):
            reporter.report(errors)
        # 将在 ./logs/errors/ 目录生成 error_report_20240215_143052.json
    """

    def __init__(self):
        """
        初始化本地文件报告器

        调用父类构造函数设置报告器名称为 'LocalFileReporter'。
        初始化日志目录为 None，需要通过 configure() 方法设置。
        """
        super().__init__("LocalFileReporter")
        self.log_dir = None

    def configure(self, log_dir: str, **config: Any) -> bool:
        """
        @methoddesc 配置日志目录并确保目录存在

        该方法设置错误报告文件的存储目录。
        如果目录不存在，会尝试自动创建。

        :param log_dir: 日志文件存放的目录路径
                       可以是相对路径（如 './logs'）或绝对路径
        :param config: 额外的可选配置参数（当前未使用，保留扩展性）
        :return: 配置是否成功。成功返回 True，失败返回 False

        配置流程：
            1. 将日志目录路径保存到实例变量
            2. 检查目录是否存在
            3. 如不存在，尝试创建目录
            4. 返回配置结果
        """
        # 保存日志目录路径到实例变量
        self.log_dir = log_dir

        try:
            # 检查目录是否存在，os.path.exists() 既检查文件也检查目录
            if not os.path.exists(self.log_dir):
                # 目录不存在，尝试创建（包括父目录）
                os.makedirs(self.log_dir)
                print(f"[{self.name}] 日志目录已创建: {self.log_dir}")

            # 配置成功
            return True

        except Exception as e:
            # 创建目录失败，打印错误信息
            print(f"[{self.name}] !! 错误: 创建日志目录失败: {e}")
            return False

    def report(self, errors: list[dict]):
        """
        @methoddesc 将错误报告写入本地 JSON 文件

        在写入前会检查日志目录是否已配置。
        文件名包含精确到秒的时间戳，确保每次报告都有唯一的文件。

        :param errors: 错误信息的字典列表，每个字典包含错误详情
                      典型字段：row_index, column, value, error_type, error_message

        写入流程：
            1. 检查日志目录是否已配置
            2. 生成包含时间戳的唯一文件名
            3. 构造完整的文件路径
            4. 使用 json.dump() 将错误列表写入文件
            5. 打印成功或失败消息

        文件格式示例：
            [
              {
                "row_index": 2,
                "column": "price",
                "value": "abc",
                "error_type": "TypeValidationError",
                "error_message": "无法将 'abc' 转换为浮点数"
              }
            ]
        """
        # 前置检查：确保日志目录已配置
        if not self.log_dir:
            print(f"[{self.name}] !! 错误: 未配置日志目录，无法写入日志。")
            return

        # 生成时间戳，用于构建唯一的文件名
        # 格式：YYYYMMDD_HHMMSS，例如 20240215_143052
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

        # 构建日志文件名
        log_filename = f"error_report_{timestamp}.json"

        # 拼接完整的文件路径
        log_filepath = os.path.join(self.log_dir, log_filename)

        try:
            # 打开文件并写入 JSON 数据
            # 使用 utf-8 编码确保中文字符正确保存
            with open(log_filepath, "w", encoding="utf-8") as f:
                # 使用 json.dump 序列化错误列表
                # indent=2 使输出的 JSON 格式化，便于人工阅读
                # ensure_ascii=False 允许直接写入 Unicode 字符（如中文）
                json.dump(errors, f, indent=2, ensure_ascii=False)

            # 写入成功，打印确认信息
            print(f"[{self.name}] ✓ 成功将错误报告写入本地日志: {log_filepath}")

        except Exception as e:
            # 写入失败，打印错误信息
            print(f"[{self.name}] !! 错误: 写入日志文件失败: {e}")
