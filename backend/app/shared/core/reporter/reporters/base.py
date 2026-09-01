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
from urllib.parse import urlparse

# 截断后追加的省略标记（各报告器共用，保证提示语义一致）
TRUNCATION_SUFFIX = "\n... (内容过长，已截断)"

# 各报告器的消息模板在 error_details 之外还含标题/时间戳/代码块围栏等固定文本，
# 截断上限需为其预留字节余量，保证整条消息编码后不超过平台限额
TEMPLATE_HEADROOM_BYTES = 256


def sanitize_url_for_log(url: str) -> str:
    """脱敏 URL 用于日志输出：只保留 scheme://host/path，丢弃 query/fragment。

    Webhook/Token 类 URL 的凭证（token、corpsecret 等）几乎都在 query 中，
    异常日志打印完整 URL 会把密钥写进日志文件。此函数只保留主机与路径。

    Args:
        url: 原始 URL（可能含敏感 query）

    Returns:
        形如 "https://open.feishu.cn/open-apis/bot/v2/hook/xxx" 的脱敏 URL；
        解析失败时返回 "<invalid-url>"（不抛异常，日志路径不允许二次失败）。
    """
    try:
        parsed = urlparse(url)
        if parsed.scheme and parsed.netloc:
            return f"{parsed.scheme}://{parsed.netloc}{parsed.path}"
        return "<invalid-url>"
    except Exception:  # noqa: BLE001  日志脱敏兜底，任何解析异常都降级为占位符
        return "<invalid-url>"


def truncate_to_byte_limit(text: str, max_bytes: int, suffix: str = TRUNCATION_SUFFIX) -> str:
    """按 UTF-8 字节数上限截断文本，超限时追加省略标记。

    平台（飞书/钉钉/企业微信）的消息限额按字节数计算。过去"按字节检查、按字符截断"
    的做法对中文内容无效：每个汉字 UTF-8 占 3 字节，按字符截掉一半后实际字节数
    仍可能超限，消息会被平台拒收。

    规则：
    - 原文未超限则原样返回；
    - 超限时按编码后字节累积截断，并回退到 UTF-8 字符边界（不截在多字节字符中间），
      追加省略标记后总长（含标记）仍不超过 max_bytes。

    Args:
        text: 原始文本
        max_bytes: 允许的最大 UTF-8 字节数
        suffix: 截断时追加的省略标记

    Returns:
        截断后的字符串（UTF-8 编码后不超过 max_bytes 字节）
    """
    encoded = text.encode("utf-8")
    if len(encoded) <= max_bytes:
        return text

    suffix_bytes = suffix.encode("utf-8")
    limit = max_bytes - len(suffix_bytes)
    if limit <= 0:
        # 防御：上限比省略标记还小，直接返回空串，保证总长不超限
        return ""

    # 从末尾回退，跳过 UTF-8 多字节序列的续字节（0b10xxxxxx），避免截在字符中间
    while limit > 0 and (encoded[limit] & 0xC0) == 0x80:
        limit -= 1

    return encoded[:limit].decode("utf-8", errors="ignore") + suffix


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
