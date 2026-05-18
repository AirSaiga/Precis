"""@fileoverview 企业微信自建应用消息推送报告器

功能概述:
- 通过企业微信自建应用发送数据验证错误报告
- 支持 Markdown 格式消息和自动 access_token 刷新
- 实现 access_token 的缓存和自动刷新机制（提前 5 分钟刷新）

架构设计:
- 继承 Reporter 抽象基类，实现 configure() 和 report() 方法
- Token 管理: _get_access_token() 实现缓存 + 自动刷新策略
- 消息截断: 企业微信消息限制约 2KB，超长内容自动截断
- 统一请求: _send_request() 封装 HTTP POST 请求和错误处理

输入示例:
    配置参数:
    {
        "corp_id": "wwxxxxxxxxxxxxxxxx",
        "corp_secret": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        "agent_id": 1000002,
        "touser": "@all"
    }

    错误数据:
    [{"error_type": "ValidationError", "row_index": 2, "column": "age", "value": "abc"}]

输出示例:
    企业微信消息 (Markdown 格式):
    ## <font color="warning">【数据验证警告】发现 1 个错误!</font>
    **请相关人员尽快处理。**
    **错误详情:**
    ```json
    [{"error_type": "ValidationError", ...}]
    ```
    > 报告时间: 2024-01-15 14:30:52

    控制台输出:
    [WeComAppReporter] ✓ 配置成功。
    [WeComAppReporter] ✓ 成功获取 Access Token。
    [WeComAppReporter] ✓ 成功发送消息。
"""

import json
import time
import urllib.request
from datetime import datetime
from typing import Any

from .base import Reporter


class WeComAppReporter(Reporter):
    """
    @classdesc 企业微信自建应用消息推送报告器

    通过企业微信自建应用发送消息，将数据验证错误报告推送给指定用户。

    Attributes:
        config: 存储配置参数的字典，包含 corp_id, corp_secret, agent_id, touser
        is_configured: 配置是否有效的标志
        access_token: 企业微信 API 访问令牌
        token_expires_at: 令牌过期时间戳
    """

    def __init__(self):
        """
        @methoddesc 初始化企业微信报告器

        设置默认属性，包括配置字典、配置状态标志、
        访问令牌及其过期时间戳。
        """
        super().__init__("WeComAppReporter")
        self.config = {}  # 存储配置参数
        self.is_configured = False  # 配置是否有效
        self.access_token = None  # 企业微信 API 访问令牌
        self.token_expires_at = 0  # 令牌过期时间戳

    def configure(self, corp_id: str, corp_secret: str, agent_id: int, touser: str, **kwargs) -> bool:
        """
        @methoddesc 配置企业微信报告器参数

        验证所有必需参数是否提供，并保存配置信息。

        Args:
            corp_id: 企业 ID（企业在企业微信中的唯一标识）
            corp_secret: 应用 Secret（用于获取 access_token）
            agent_id: 应用 AgentID（企业微信应用编号）
            touser: 接收者用户账号（@all 表示发送给全部成员）
            **kwargs: 额外参数（保留用于扩展）

        Returns:
            bool: 配置是否成功
        """
        # 参数验证：确保所有必需参数都提供
        if not all([corp_id, corp_secret, agent_id, touser]):
            self.is_configured = False
            return False

        # 保存配置参数
        self.config = {"corp_id": corp_id, "corp_secret": corp_secret, "agent_id": agent_id, "touser": touser}
        self.is_configured = True
        print(f"[{self.name}] ✓ 配置成功。")
        return True

    def _get_access_token(self):
        """
        @methoddesc 获取或刷新企业微信 API 访问令牌（Access Token）

        访问令牌用于调用企业微信 API，有效期默认为 7200 秒（2 小时）。
        实现自动刷新机制：在过期前 5 分钟自动刷新，避免令牌失效。

        Token 刷新逻辑：
        - 检查当前时间是否早于过期时间
        - 如果是，直接返回缓存的令牌
        - 否则调用企业微信 API 获取新令牌并更新缓存

        Returns:
            str: 有效的访问令牌，如果获取失败返回 None

        API 调用：
        - URL: https://qyapi.weixin.qq.com/cgi-bin/gettoken
        - 参数: corpid, corpsecret
        - 响应: access_token, expires_in (有效期秒数)
        """
        # 检查令牌是否仍然有效（提前 5 分钟刷新）
        if time.time() < self.token_expires_at:
            return self.access_token

        # 调用企业微信 API 获取令牌
        url = f"https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid={self.config['corp_id']}&corpsecret={self.config['corp_secret']}"
        try:
            # 发送请求
            with urllib.request.urlopen(url, timeout=10) as response:
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
        4. 调用企业微信发送应用消息 API

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

        # 安全截断：企业微信消息内容限制约 2KB
        # 超过限制时进行截断并添加提示
        if len(error_details.encode("utf-8")) > 2048:
            error_details = error_details[:1000] + "\n... (内容过长，已截断)"

        # 步骤3: 构建 Markdown 格式消息内容
        # 企业微信支持部分 HTML 标签和字体颜色
        content = f"""## <font color=\"warning\">【数据验证警告】发现 {error_count} 个错误!</font>
**请相关人员尽快处理。**
**错误详情:**
```json
{error_details}
```
> 报告时间: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}
"""

        # 步骤4: 构建发送应用消息的请求负载
        payload = {
            "touser": self.config["touser"],  # 接收者：用户账号
            "msgtype": "markdown",  # 消息类型：Markdown
            "agentid": self.config["agent_id"],  # 应用 AgentID
            "markdown": {
                "content": content  # 消息正文内容
            },
        }

        # 步骤5: 发送消息
        url = f"https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token={token}"
        self._send_request(url, payload)

    def _send_request(self, url: str, payload: dict[str, Any]):
        """
        @methoddesc 发送 HTTP POST 请求到企业微信 API

        处理所有企业微信 API 的 HTTP 通信，包括错误处理和日志记录。

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
