"""@fileoverview 报告器抽象基类

功能概述:
- 定义所有报告器的统一接口（Strategy 模式）
- 提供 configure() 和 report() 抽象方法
- 强制子类实现配置和报告的标准化流程

架构设计:
- 策略模式 (Strategy Pattern): 将不同的报告渠道封装为可互换的算法
- 模板方法模式: 定义 report() 和 configure() 的标准接口，子类负责具体实现
- 依赖倒置: 高层模块（ReportService）依赖抽象（Reporter），而非具体实现

输入示例:
    子类实现示例:
    class MyReporter(Reporter):
        def configure(self, **config) -> bool:
            # 验证并保存配置
            self.webhook_url = config.get("webhook_url")
            return bool(self.webhook_url)

        def report(self, errors: list[dict]):
            # 发送错误报告到自定义渠道
            requests.post(self.webhook_url, json=errors)

输出示例:
    客户端代码无需关心具体实现:
    reporter: Reporter = EmailReporter()  # 或任何其他报告器
    if reporter.configure(**config):
        reporter.report(errors)
"""

from abc import ABC, abstractmethod
from typing import Any


class Reporter(ABC):
    """
    @classdesc 报告器抽象基类

    该类定义了所有报告器必须实现的接口规范。
    采用策略模式，任何需要报告数据验证错误的模块都可以通过统一的接口调用不同的报告策略。

    属性说明：
        name: 报告器实例的名称，用于日志和调试标识

    使用示例：
        # 客户端代码不关心具体使用哪种报告器
        reporter: Reporter = EmailReporter()
        reporter.configure(**email_config)
        reporter.report(errors)
    """

    def __init__(self, name: str):
        """
        初始化报告器实例

        :param name: 报告器的名称，用于日志输出和调试追踪
        """
        self.name = name

    @abstractmethod
    def configure(self, **config: Any) -> bool:
        """
        @methoddesc 配置当前报告器

        这是一个抽象方法，每个子类必须实现自己的配置逻辑。
        配置通常包括连接信息、认证凭证、目标路径等。

        :param config: 关键字参数，包含特定报告器的配置选项
                      不同的报告器子类有不同的配置要求
        :return: 配置是否成功。返回 True 表示配置生效，可以调用 report()；
                 返回 False 表示配置失败，需要检查配置参数或日志

        子类实现注意事项：
            - 应该验证所有必需的配置参数
            - 应该在失败时打印详细的错误信息
            - 可以选择在配置阶段建立连接（如邮件SMTP连接）进行验证
        """
        pass

    @abstractmethod
    def report(self, errors: list[dict]):
        """
        @methoddesc 执行报告操作，将错误信息发送或写入指定目标

        这是一个抽象方法，每个子类必须实现自己的报告逻辑。
        在调用此方法之前，必须确保 configure() 已经成功调用。

        :param errors: 错误信息的字典列表
                      每个字典代表一个独立的验证错误
                      标准格式包含：row_index, column, value, error_type, error_message
                      不同报告器可能对格式有特定要求

        错误字典的推荐字段：
            - row_index: 错误发生的行号（可选，列级别错误可能为 None）
            - column: 涉及的数据列名
            - value: 导致错误的原始值
            - error_type: 错误类型标识（如 'TypeValidationError'）
            - error_message: 人类可读的错误描述

        子类实现注意事项：
            - 应该检查是否已正确配置（如检查 is_configured 标志）
            - 应该处理空列表的情况（空列表通常不需要报告）
            - 应该在失败时打印错误日志，但不应抛出异常
        """
        pass
