"""@fileoverview 飞书消息推送报告器

功能概述:
- 通过飞书 Webhook/App/Service 三种模式发送错误报告
- 支持 Interactive Card 消息卡片和自动签名验证
- 三种模式按安全性优先级自动选择: Service > App > Webhook

架构设计:
- 继承 Reporter 抽象基类，实现 configure() 和 report() 方法
- 多模式策略: configure() 根据提供的参数自动选择最佳模式
- Token 管理: App 模式下 _get_tenant_access_token() 实现缓存 + 自动刷新
- 签名验证: Webhook 模式下 _generate_sign() 实现 HMAC-SHA256 签名
- 消息标准化: _create_message_card() 统一生成飞书卡片消息结构
- 通用请求: _send_request() 封装所有 HTTP 通信

输入示例:
    Service 模式配置 (推荐):
    {"service_url": "https://my-service.com/feishu", "api_key": "xxx"}

    App 模式配置:
    {"app_id": "cli_xxx", "app_secret": "xxx", "receive_ids": "ou_xxx", "receive_id_type": "open_id"}

    Webhook 模式配置:
    {"webhook_url": "https://open.feishu.cn/open-apis/bot/v2/hook/xxx", "secret": "xxx"}

输出示例:
    飞书卡片消息:
    {
        "config": {"wide_screen_mode": True},
        "header": {"template": "red", "title": {"content": "【数据验证警告】发现 3 个错误!", "tag": "plain_text"}},
        "elements": [...]
    }

    控制台输出:
    [FeishuReporter] ✓ 配置成功 (模式: 自建应用)。
    [FeishuReporter] ✓ 成功获取 Tenant Access Token。
    [FeishuReporter] ✓ 成功发送消息 给 ou_xxx。
"""

import base64
import hashlib
import hmac
import ipaddress
import json
import time
import urllib.request
from datetime import datetime
from typing import Any
from urllib.parse import urlparse

from .base import Reporter

_ALLOWED_URL_SCHEMES = {"https", "http"}
_BLOCKED_NETWORKS = [
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),
]


def _validate_webhook_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in _ALLOWED_URL_SCHEMES:
        raise ValueError(f"不支持的 URL scheme: {parsed.scheme}，仅允许 {_ALLOWED_URL_SCHEMES}")
    hostname = parsed.hostname
    if not hostname:
        raise ValueError("URL 缺少主机名")
    try:
        for network in _BLOCKED_NETWORKS:
            if ipaddress.ip_address(hostname) in network:
                raise ValueError(f"不允许访问内网地址: {hostname}")
    except ValueError:
        if "ValueError: 不允许访问内网地址" in str(ValueError):
            raise
    except Exception:
        pass


class FeishuReporter(Reporter):
    """
    @classdesc 飞书消息推送报告器

    通过飞书发送数据验证错误报告，支持三种发送模式：
    1. Webhook: 单用户快速集成，零部署
    2. App: 团队使用，需要分发凭证
    3. Service: 团队使用，通过中心化服务统一管理，最安全

    Attributes:
        config: 存储配置参数的字典
        mode: 当前使用的发送模式 ('webhook', 'app', 'service')
        is_configured: 配置是否有效的标志
        tenant_access_token: 飞书应用访问令牌（App 模式专用）
        token_expires_at: 令牌过期时间戳（App 模式专用）
    """

    def __init__(self):
        """
        @methoddesc 初始化飞书报告器

        设置默认属性，包括配置字典、发送模式、配置状态标志，
        以及 App 模式专用的访问令牌和过期时间戳。
        """
        super().__init__("FeishuReporter")
        self.config = {}  # 存储配置参数
        self.mode = None  # 当前发送模式: 'webhook' | 'app' | 'service'
        self.is_configured = False  # 配置是否有效

        # App 模式专用属性
        self.tenant_access_token = None  # 飞书应用访问令牌
        self.token_expires_at = 0  # 令牌过期时间戳

    def configure(self, **config: Any) -> bool:
        """
        @methoddesc 根据配置参数自动检测并设置最佳操作模式

        配置优先级（按安全性排序）：
        1. Service 模式：需要 service_url 和 api_key
        2. App 模式：需要 app_id, app_secret 和 receive_ids
        3. Webhook 模式：只需要 webhook_url

        Args:
            **config: 包含飞书配置的键值对
                - service_url: 中心化服务地址
                - api_key: API 密钥
                - app_id: 应用 ID
                - app_secret: 应用密钥
                - receive_ids: 接收者 ID 列表
                - receive_id_type: 接收者 ID 类型
                - webhook_url: Webhook 地址
                - secret: 签名密钥

        Returns:
            bool: 配置是否成功
        """
        self.config = config

        # 模式三：中心化服务模式（最高优先级，最安全）
        # 适用于团队统一管理所有消息通知
        if config.get("service_url") and config.get("api_key"):
            self.mode = "service"
            self.is_configured = True
            print(f"[{self.name}] ✓ 配置成功 (模式: 中心化服务)。")
            return True

        # 模式二：自建应用模式
        # 适用于需要发送给多个用户且有飞书应用的团队
        if config.get("app_id") and config.get("app_secret") and config.get("receive_ids"):
            self.mode = "app"
            self.is_configured = True
            print(f"[{self.name}] ✓ 配置成功 (模式: 自建应用)。")
            return True

        # 模式一：Webhook 模式（最低优先级）
        # 适用于快速集成和单用户场景
        if config.get("webhook_url"):
            self.mode = "webhook"
            self.is_configured = True
            print(f"[{self.name}] ✓ 配置成功 (模式: Webhook)。")
            return True

        # 配置不完整时输出错误提示
        print(
            f"[{self.name}] !! 错误: 配置不完整。请提供 'service_url'/'api_key' 或 'app_id'/'app_secret' 或 'webhook_url'。"
        )
        return False

    def report(self, errors: list[dict]):
        """
        @methoddesc 发送错误报告的主入口方法

        根据当前配置的模式调用相应的发送方法。
        如果未配置，则跳过发送并输出提示。

        Args:
            errors: 错误信息列表，每个元素是一个包含错误详情的字典
        """
        # 前置检查：确保已正确配置
        if not self.is_configured:
            print(f"[{self.name}] 未配置，跳过报告。")
            return

        # 步骤1: 统一创建消息卡片内容
        # 将错误列表转换为飞书消息卡片格式
        card_content = self._create_message_card(errors)

        # 步骤2: 根据模式分发到不同的发送方法
        if self.mode == "service":
            self._report_via_service(card_content)
        elif self.mode == "app":
            self._report_via_app(card_content)
        elif self.mode == "webhook":
            self._report_via_webhook(card_content)

    def _create_message_card(self, errors: list[dict]) -> dict:
        """
        @methoddesc 统一生成飞书 Interactive Card 消息卡片结构体

        消息卡片包含：
        - 红色标题栏显示错误数量
        - 错误详情的 JSON 格式化展示
        - 报告时间戳

        Args:
            errors: 错误信息列表

        Returns:
            Dict: 飞书消息卡片的 JSON 结构
        """
        # 统计错误数量
        error_count = len(errors)
        # 将错误列表序列化为格式化的 JSON 字符串
        error_details = json.dumps(errors, indent=2, ensure_ascii=False)

        # 安全截断：飞书消息卡片大小限制约为 30KB
        # 这里做保守截断（28KB），防止超出限制导致发送失败
        if len(error_details.encode("utf-8")) > 28000:
            error_details = error_details[:14000] + "\n... (内容过长，已截断)"

        # 构建飞书卡片消息结构
        return {
            "config": {"wide_screen_mode": True},  # 宽屏模式
            "header": {
                "template": "red",  # 红色标题表示警告
                "title": {"content": f"【数据验证警告】发现 {error_count} 个错误!", "tag": "plain_text"},
            },
            "elements": [
                # 错误详情区域：使用 Markdown 代码块格式
                {"tag": "div", "text": {"content": f"**错误详情:**\n```{error_details}```", "tag": "lark_md"}},
                {"tag": "hr"},  # 分割线
                # 底部备注：显示报告时间
                {
                    "tag": "note",
                    "elements": [
                        {"content": f"报告时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}", "tag": "lark_md"}
                    ],
                },
            ],
        }

    # ==============================================================================
    # 模式一：Webhook 实现
    # ==============================================================================
    def _report_via_webhook(self, card_content: dict):
        """
        @methoddesc 通过 Webhook 发送消息（Webhook 模式）

        适用于单用户快速集成场景。Webhook 是开放接口，
        通过签名验证请求合法性。

        Args:
            card_content: 飞书消息卡片内容字典
        """
        # 构建消息负载：包含卡片类型和内容
        payload: dict[str, Any] = {"msg_type": "interactive", "card": card_content}

        # 可选：添加签名验证（如果配置了 secret）
        secret = self.config.get("secret")
        if secret:
            # 生成签名：timestamp + secret -> HMAC-SHA256 -> Base64
            timestamp = int(time.time())
            sign = self._generate_sign(secret, timestamp)
            payload["timestamp"] = timestamp
            payload["sign"] = sign

        # 发送 HTTP POST 请求
        self._send_request(
            url=self.config["webhook_url"], payload=payload, headers={"Content-Type": "application/json"}
        )

    def _generate_sign(self, secret: str, timestamp: int) -> str:
        """
        @methoddesc 生成飞书 Webhook 签名

        签名算法：
        1. 拼接 timestamp 和 secret 成字符串
        2. 使用 HMAC-SHA256 算法加密
        3. Base64 编码结果

        Args:
            secret: Webhook 签名密钥
            timestamp: 时间戳（秒）

        Returns:
            str: 签名字符串
        """
        # 构造待签名字符串：timestamp + 换行 + secret
        string_to_sign = f"{timestamp}\n{secret}"
        # HMAC-SHA256 加密
        hmac_code = hmac.new(string_to_sign.encode("utf-8"), digestmod=hashlib.sha256).digest()
        # Base64 编码
        return base64.b64encode(hmac_code).decode("utf-8")

    # ==============================================================================
    # 模式二：自建应用实现
    # ==============================================================================
    def _report_via_app(self, card_content: dict):
        """
        @methoddesc 通过飞书自建应用发送消息（App 模式）

        适用于团队场景，需要预先创建飞书自建应用并配置权限。
        消息通过飞书开放平台 API 发送。

        Args:
            card_content: 飞书消息卡片内容字典
        """
        # 步骤1: 获取有效的访问令牌
        token = self._get_tenant_access_token()
        if not token:
            return

        # 步骤2: 解析接收者列表
        # 支持逗号分隔的多个接收者
        receive_id_list = self.config["receive_ids"].split(",")
        receive_id_type = self.config.get("receive_id_type", "open_id")

        # 步骤3: 构建飞书 IM API 请求
        url = f"https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type={receive_id_type}"
        headers = {"Content-Type": "application/json", "Authorization": f"Bearer {token}"}

        # 步骤4: 逐个向接收者发送消息
        for receive_id in receive_id_list:
            # 构建消息负载
            # 注意：content 字段需要 JSON 序列化为字符串
            payload = {"receive_id": receive_id.strip(), "msg_type": "interactive", "content": json.dumps(card_content)}
            self._send_request(url, payload, headers, target_id=receive_id.strip())

    def _get_tenant_access_token(self):
        """
        @methoddesc 获取飞书应用访问令牌（Tenant Access Token）

        令牌用于调用飞书开放平台 API，有效期约 2 小时。
        实现自动刷新机制：在过期前 5 分钟自动刷新。

        Returns:
            str: 有效的访问令牌，如果获取失败返回 None

        Token 刷新逻辑：
        - 检查当前时间是否早于过期时间
        - 如果是，直接返回缓存的令牌
        - 否则调用 API 获取新令牌并更新缓存
        """
        # 检查令牌是否仍然有效（提前 5 分钟刷新）
        if time.time() < self.token_expires_at:
            return self.tenant_access_token

        # 调用飞书 OAuth API 获取令牌
        url = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal"
        payload = {"app_id": self.config["app_id"], "app_secret": self.config["app_secret"]}
        try:
            # 构建 HTTP 请求
            req_data = json.dumps(payload).encode("utf-8")
            req = urllib.request.Request(url, data=req_data, headers={"Content-Type": "application/json"})

            # 发送请求并解析响应
            with urllib.request.urlopen(req, timeout=10) as response:
                result = json.loads(response.read().decode())
                if result.get("code") == 0:
                    # 成功获取令牌
                    self.tenant_access_token = result["tenant_access_token"]
                    # 设置过期时间：当前时间 + 有效期 - 缓冲时间
                    self.token_expires_at = time.time() + result["expire"] - 300
                    print(f"[{self.name}] ✓ 成功获取 Tenant Access Token。")
                    return self.tenant_access_token
                else:
                    print(f"[{self.name}] !! 错误: 获取 Tenant Access Token 失败: {result.get('msg')}")
                    return None
        except Exception as e:
            print(f"[{self.name}] !! 错误: 请求 Tenant Access Token 失败: {e}")
            return None

    # ==============================================================================
    # 模式三：中心化服务实现
    # ==============================================================================
    def _report_via_service(self, card_content: dict):
        """
        @methoddesc 通过中心化服务发送消息（Service 模式）

        适用于团队统一管理消息通知的场景。
        所有消息通过自建的中转服务发送，安全性最高。

        Args:
            card_content: 飞书消息卡片内容字典
        """
        # 构建请求头：包含 API 密钥认证
        headers = {"Content-Type": "application/json", "Authorization": f"Bearer {self.config['api_key']}"}

        # 生成简要摘要信息
        # 从卡片内容中提取错误数量
        error_lines = card_content["elements"][0]["text"]["content"].splitlines()
        _summary_count = len(error_lines) - 2 if len(error_lines) > 2 else 0

        # 构建请求负载：将卡片内容序列化为 JSON 字符串
        # 服务端负责解析和发送飞书消息
        payload = {"message": json.dumps(card_content)}

        # 发送请求到中心化服务
        self._send_request(self.config["service_url"], payload, headers)

    # ==============================================================================
    # 通用请求发送器
    # ==============================================================================
    def _send_request(self, url: str, payload: dict, headers: dict, target_id: str = "N/A"):
        """
        @methoddesc 通用 HTTP POST 请求发送器

        处理所有飞书 API 的 HTTP 通信，包括错误处理和日志记录。

        Args:
            url: 请求目标 URL
            payload: 请求体数据字典
            headers: HTTP 请求头字典
            target_id: 目标接收者 ID（用于日志记录）
        """
        try:
            _validate_webhook_url(url)
        except ValueError as e:
            print(f"[{self.name}] !! 错误: URL 校验失败: {e}")
            return

        try:
            # 序列化请求负载为 JSON 字节
            data = json.dumps(payload).encode("utf-8")

            # 构建 HTTP 请求
            req = urllib.request.Request(url, data=data, headers=headers)

            # 发送请求并获取响应
            with urllib.request.urlopen(req, timeout=10) as response:
                result_str = response.read().decode("utf-8")
                result = json.loads(result_str)

                # 判断不同 API 的成功响应码
                # 飞书 Webhook/App API: code == 0
                # 通用 HTTP: status < 300
                if result.get("code") == 0 or result.get("status_code") == 0 or response.status < 300:
                    target_info = f"给 {target_id}" if target_id != "N/A" else ""
                    print(f"[{self.name}] ✓ 成功发送消息 {target_info}。")
                else:
                    # 提取错误信息（不同 API 字段名不同）
                    print(f"[{self.name}] !! 错误: 发送消息失败: {result.get('msg', result_str)}")
        except Exception as e:
            print(f"[{self.name}] !! 错误: 发送请求到 '{url}' 失败: {e}")
