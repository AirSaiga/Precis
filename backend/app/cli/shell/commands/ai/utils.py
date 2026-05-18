# backend/app/cli/shell/commands/ai/utils.py
"""
@fileoverview AI 命令共享工具模块

功能概述:
- 提供 AI 命令的通用工具函数
- 支持 API Key 脱敏、temperature 错误重试判断
- 提供表名模糊匹配、歧义解析、操作确认与上下文构建
- 提供 Spinner 动画辅助函数

架构设计:
- mask_api_key: 对 API Key 进行脱敏处理，保护密钥安全
- should_retry_without_temperature: 根据错误信息判断是否应移除 temperature 后重试
- resolve_table_name: 使用 find_matching_schemas 实现模糊匹配，支持交互式选择
- resolve_ambiguities: 遍历 AI 返回的动作列表，解析表名歧义
- confirm_actions: 在修改前向用户展示操作列表并确认
- build_context_data: 从项目中读取 schema 信息，构建 AI 上下文
- create_spinner/stop_spinner: 简单的 spinner 线程辅助函数

输入示例:
    mask_api_key("sk-abcdef1234567890")
    resolve_table_name("users", "/path/to/project")
    confirm_actions(actions, reply)

输出示例:
    "sk-abc...7890"
    "users_table_id"
    True/False
"""

import logging

logger = logging.getLogger(__name__)


def mask_api_key(api_key: str) -> str:
    """脱敏 API Key，只显示前 6 位和后 4 位。

    如果密钥过短，则显示掩码 ***。

    Args:
        api_key: 原始 API Key 字符串

    Returns:
        脱敏后的字符串
    """
    if not api_key or len(api_key) < 10:
        return "***"
    return f"{api_key[:6]}...{api_key[-4:]}"


def should_retry_without_temperature(error_str: str) -> bool:
    """判断是否应移除 temperature 参数后重试。

    仅针对特定的 temperature 相关 400 错误才重试，避免浪费 API 调用。
    认证错误（401/403）和模型错误不重试。

    Args:
        error_str: 错误信息字符串

    Returns:
        是否应移除 temperature 后重试
    """
    error_lower = error_str.lower()

    # 不重试的认证相关错误（HTTP 401/403）
    auth_errors = [
        "401",
        "unauthorized",
        "authentication",
        "403",
        "forbidden",
        "permission",
        "invalid api key",
        "incorrect api key",
        "rate limit",
        "429",
        "too many requests",
    ]
    for auth_err in auth_errors:
        if auth_err in error_lower:
            logger.debug(f"认证或限流错误，不重试: {auth_err}")
            return False

    # 不重试的模型相关错误
    model_errors = [
        "model not found",
        "model does not exist",
        "invalid model",
        "unsupported model",
    ]
    for model_err in model_errors:
        if model_err in error_lower:
            logger.debug(f"模型错误，不重试: {model_err}")
            return False

    # 需要重试的 temperature 相关错误
    retryable_errors = [
        "temperature",
        "sampling",
        "parameter",
        "400",
        "bad request",
        "invalid request",
    ]
    for retry_err in retryable_errors:
        if retry_err in error_lower:
            # 进一步确认是参数相关错误
            if any(kw in error_lower for kw in ["temperature", "sampling", "parameter"]):
                logger.debug(f"检测到 temperature 相关错误，允许重试: {retry_err}")
                return True

    return False
