# backend/app/cli/shell/commands/ai/utils.py
"""
@fileoverview AI 命令共享工具模块

功能概述:
- 提供 AI 命令的通用工具函数
- 支持 API Key 脱敏

架构设计:
- mask_api_key: 对 API Key 进行脱敏处理，保护密钥安全

输入示例:
    mask_api_key("sk-abcdef1234567890")
    resolve_table_name("users", "/path/to/project")
    confirm_actions(actions, reply)

输出示例:
    "sk-abc...7890"
    "users_table_id"
    True/False
"""


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
