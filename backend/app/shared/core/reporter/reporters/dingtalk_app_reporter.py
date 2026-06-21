"""@fileoverview 钉钉自建应用消息推送报告器

功能概述:
- 通过钉钉企业内部应用发送数据验证错误报告
- 支持 Markdown 格式消息，自动获取和管理 access_token
- 实现 access_token 的缓存和自动刷新机制（提前 5 分钟刷新）

架构设计:
- 继承 Reporter 抽象基类，实现 configure() 和 report() 方法
- Token 管理: _get_access_token() 实现缓存 + 自动刷新策略
- 消息截断: 钉钉消息限制约 4KB，超长内容自动截断
- 统一请求: _send_request() 封装 HTTP POST 请求和错误处理

输入示例:
    配置参数:
    {
        "app_key": "dingxxxxxxxxxxxx",
        "app_secret": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        "agent_id": 123456789,
        "userid_list": "user1,user2"
    }

    错误数据:
    [{"error_type": "ValidationError", "row_index": 2, "column": "age", "value": "abc"}]

输出示例:
    钉钉消息 (Markdown 格式):
    ### 【数据验证警告】发现 1 个错误!
    **错误详情:**
    ```json
    [{"error_type": "ValidationError", ...}]
    ```
    > **报告时间:** 2024-01-15 14:30:52

    控制台输出:
    [DingTalkAppReporter] ✓ 配置成功。
    [DingTalkAppReporter] ✓ 成功获取 Access Token。
    [DingTalkAppReporter] ✓ 成功发送消息。
"""

import json
import time
import urllib.parse
import urllib.request
from datetime import datetime
from typing import Any

from .base import Reporter


class DingTalkAppReporter(Reporter):
    """
    @classdesc 钉钉自建应用消息推送报告器

    通过钉钉企业内部应用发送工作通知，将数据验证错误报告推送给指定用户。

    Attributes:
        config: 存储配置参数的字典，包含 app_key, app_secret, agent_id, userid_list
        is_configured: 配置是否有效的标志
        access_token: 钉钉 API 访问令牌
        token_expires_at: 令牌过期时间戳
    """

    def __init__(self):
        """
        @methoddesc 初始化钉钉报告器

        设置默认属性，包括配置字典、配置状态标志、
        访问令牌及其过期时间戳。
        """
        super().__init__("DingTalkAppReporter")
        self.config = {}  # 存储配置参数
        self.is_configured = False  # 配置是否有效
        self.access_token = None  # 钉钉 API 访问令牌
        self.token_expires_at = 0  # 令牌过期时间戳

    def configure(self, **kwargs) -> bool:
        """
        @methoddesc 配置钉钉报告器参数

        验证所有必需参数是否提供，并保存配置信息。

        Args:
            app_key: 钉钉应用 Key（企业标识下的唯一 ID）
            app_secret: 钉钉应用密钥（用于获取 access_token）
            agent_id: 钉钉应用 AgentID（用于指定发送目标应用）
            userid_list: 接收者用户 ID 列表（逗号分隔的字符串）
            **kwargs: 额外参数（保留用于扩展）

        Returns:
            bool: 配置是否成功
        """
        # 参数验证：确保所有必需参数都提供
        app_key = kwargs.get("app_key")
        app_secret = kwargs.get("app_secret")
        agent_id = kwargs.get("agent_id")
        userid_list = kwargs.get("userid_list")
        if not all([app_key, app_secret, agent_id, userid_list]):
            self.is_configured = False
            return False

        # 显式处理 None，避免 mypy 将 Any | None 传给 int() 时报错
        if agent_id is None:
            self.is_configured = False
            return False

        # 保存配置参数
        self.config = {
            "app_key": str(app_key),
            "app_secret": str(app_secret),
            "agent_id": int(agent_id),
            "userid_list": str(userid_list),
        }
        self.is_configured = True
        print(f"[{self.name}] ✓ 配置成功。")
        return True

    def _get_access_token(self):
        """
        @methoddesc 获取或刷新钉钉 API 访问令牌（Access Token）

        访问令牌用于调用钉钉 API，有效期默认为 7200 秒（2 小时）。
        实现自动刷新机制：在过期前 5 分钟自动刷新，避免令牌失效。

        Token 刷新逻辑：
        - 检查当前时间是否早于过期时间
        - 如果是，直接返回缓存的令牌
        - 否则调用钉钉 API 获取新令牌并更新缓存

        Returns:
            str: 有效的访问令牌，如果获取失败返回 None

        API 调用：
        - URL: https://oapi.dingtalk.com/gettoken
        - 参数: appkey, appsecret
        - 响应: access_token, expire (有效期秒数)
        """
        # 检查令牌是否仍然有效（提前 5 分钟刷新）
        if time.time() < self.token_expires_at:
            return self.access_token

        # 调用钉钉 API 获取令牌
        url = "https://oapi.dingtalk.com/gettoken"
        params = {"appkey": self.config["app_key"], "appsecret": self.config["app_secret"]}
        try:
            # 构建 URL 参数
            full_url = f"{url}?{urllib.parse.urlencode(params)}"

            # 发送请求
            with urllib.request.urlopen(full_url, timeout=10) as response:
                data = json.loads(response.read().decode())
                if data.get("errcode") == 0:
                    # 成功获取令牌
                    self.access_token = data["access_token"]
                    # 设置过期时间：当前时间 + 有效期 - 缓冲时间（5分钟）
                    self.token_expires_at = time.time() + data["expires_in"] - 300
                    print(f"[{self.name}] ✓ 成功获取 Access Token。")
                    return self.access_token
                else:
                    print(f"[{self.name}] !! 错误: 获取 Access Token 失败: {data.get('errmsg')}")
                    return None
        except Exception as e:
            print(f"[{self.name}] !! 错误: 请求 Access Token 失败: {e}")
            return None

    def report(self, errors: list[dict]):
        """
        @methoddesc 发送错误报告的主入口方法

        流程：
        1. 检查配置是否有效
        2. 获取有效的访问令牌
        3. 格式化错误信息为 Markdown
        4. 调用钉钉发送工作通知 API

        Args:
            errors: 错误信息列表，每个元素是一个包含错误详情的字典
        """
        # 前置检查：确保已正确配置
        if not self.is_configured:
            return

        # 步骤1: 获取有效的访问令牌
        token = self._get_access_token()
        if not token:
            return

        # 步骤2: 统计错误数量并格式化详情
        error_count = len(errors)
        error_details = json.dumps(errors, indent=2, ensure_ascii=False)

        # 安全截断：钉钉消息内容限制约 4KB
        # 超过限制时进行截断并添加提示
        if len(error_details.encode("utf-8")) > 4000:
            error_details = error_details[:2000] + "\n... (内容过长，已截断)"

        # 步骤3: 构建 Markdown 格式消息内容
        title = f"【数据验证警告】发现 {error_count} 个错误!"
        text = f"""### {title}
**错误详情:**
```json
{error_details}
```
> **报告时间:** {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}
"""

        # 步骤4: 构建发送工作通知的请求负载
        payload = {
            "agent_id": self.config["agent_id"],  # 应用 AgentID
            "userid_list": self.config["userid_list"],  # 接收者用户列表
            "msg": {
                "msgtype": "markdown",  # 消息类型：Markdown
                "markdown": {
                    "title": title,  # 消息标题（通知标题）
                    "text": text,  # 消息正文内容
                },
            },
        }

        # 步骤5: 发送消息
        url = f"https://oapi.dingtalk.com/topapi/message/corpconversation/asyncsend_v2?access_token={token}"
        self._send_request(url, payload)

    def _send_request(self, url: str, payload: dict[str, Any]):
        """
        @methoddesc 发送 HTTP POST 请求到钉钉 API

        处理所有钉钉 API 的 HTTP 通信，包括错误处理和日志记录。

        Args:
            url: 请求目标 URL
            payload: 请求体数据字典
        """
        try:
            # 序列化请求负载为 JSON 字节
            data = json.dumps(payload).encode("utf-8")
            headers = {"Content-Type": "application/json"}

            # 构建 HTTP 请求
            req = urllib.request.Request(url, data=data, headers=headers)

            # 发送请求并获取响应
            with urllib.request.urlopen(req, timeout=10) as response:
                result = json.loads(response.read().decode("utf-8"))
                if result.get("errcode") == 0:
                    print(f"[{self.name}] ✓ 成功发送消息。")
                else:
                    print(f"[{self.name}] !! 错误: 发送消息失败: {result.get('errmsg')}")
        except Exception as e:
            print(f"[{self.name}] !! 错误: 发送请求失败: {e}")
