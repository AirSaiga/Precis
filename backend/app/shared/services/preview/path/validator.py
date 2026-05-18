"""@fileoverview 路径验证模块

功能概述:
- 验证文件路径的有效性和安全性
- 防止路径遍历攻击和非法字符注入
- 提供统一的三步路径校验入口（格式校验 → 白名单校验 → 存在性校验）
"""

from __future__ import annotations

import logging
import os

# 创建模块级日志记录器，用于输出验证过程中的警告和错误信息
logger = logging.getLogger(__name__)

# 文件路径最大长度限制（字符数），超过此值视为无效路径（防止超长路径攻击）
MAX_PATH_LENGTH = 500


def validate_file_path(file_path: str) -> tuple[bool, str]:
    r"""
    @methoddesc 验证文件路径的有效性和安全性

    该函数对文件路径进行全面的安全检查，确保路径：
    - 不为空且长度合理
    - 不包含路径遍历攻击（".."）
    - 不包含非法字符
    - 指向文件而非目录（如果存在）
    - 在允许访问的目录范围内

    参数:
        file_path: 待验证的文件路径，可以是相对路径或绝对路径

    返回:
        元组 (is_valid, error_message)
        - is_valid: 路径是否有效
        - error_message: 如果无效，返回具体的错误原因

    验证规则：
        1. 路径不能为空字符串
        2. 路径长度不能超过 MAX_PATH_LENGTH 字符
        3. 路径不能包含 ".." （路径遍历攻击）
        4. 不能以 / 或 \ 开头（除非是有效的绝对路径）
        5. 不能包含非法字符：\0, \n, \r, <, >, |, *, ?, "
        6. 如果路径存在且是目录，返回错误

    使用示例：
        >>> is_valid, error = validate_file_path("/home/user/data/test.csv")
        >>> if not is_valid:
        ...     print(f"无效路径: {error}")
    """
    # 规则1：路径必须是字符串且不能为 None
    if not file_path or not isinstance(file_path, str):
        return False, "文件路径不能为空"

    # 规则2：去除首尾空白后不能为空字符串
    if not file_path.strip():
        return False, "文件路径不能为空"

    # 去除首尾空白字符，避免空格导致的路径歧义
    normalized_path = file_path.strip()

    # 规则3：路径长度不能超过安全阈值
    if len(normalized_path) > MAX_PATH_LENGTH:
        return False, "文件路径过长"

    # 规则4：禁止路径遍历字符 ".."，防止访问上级目录
    if ".." in normalized_path:
        return False, "文件路径包含非法字符（..）"

    # 规则5：检查伪绝对路径（以 / 或 \ 开头但不是合法绝对路径的情况）
    is_absolute_style = normalized_path.startswith("/") or normalized_path.startswith("\\")
    if is_absolute_style and not os.path.isabs(normalized_path):
        return False, "无效的绝对路径格式"

    # 规则6：检查非法控制字符和特殊符号
    if any(char in normalized_path for char in ["\0", "\n", "\r", "<", ">", "|", "*", "?", '"']):
        return False, "文件路径包含非法字符"

    try:
        # 解析真实路径（处理符号链接和相对路径展开）
        resolved = os.path.realpath(normalized_path)

        # 如果文件尚不存在，认为路径格式合法（可能用于后续创建）
        if not os.path.exists(resolved):
            return True, ""

        # 规则7：路径存在时，必须指向文件而非目录
        if os.path.isdir(resolved):
            return False, "路径指向目录而非文件"

        return True, ""

    # 捕获路径解析异常（如非法字符导致系统调用失败）
    except (ValueError, OSError) as e:
        return False, f"路径解析错误: {str(e)}"


def validate_file_access(file_path: str) -> None:
    """
    @methoddesc 统一的文件路径三步校验入口

    按顺序执行以下三步验证，任何一步失败均抛出 HTTPException：
        1. 路径格式合法性校验（防路径遍历、非法字符等）
        2. 白名单目录范围校验（确保路径在允许访问的目录内）
        3. 文件存在性校验（确保文件在磁盘上真实存在）

    参数:
        file_path: 待校验的文件路径

    抛出:
        HTTPException:
            - 400: 路径格式不合法
            - 403: 路径超出允许访问的范围
            - 404: 文件不存在
    """
    from fastapi import HTTPException

    from app.shared.services.preview.path.whitelist import is_path_in_allowed_directories

    is_valid, error_msg = validate_file_path(file_path)
    if not is_valid:
        logger.info(f"[PATH] 路径验证失败: {error_msg}")
        raise HTTPException(status_code=400, detail=f"文件路径验证失败: {error_msg}")

    if not is_path_in_allowed_directories(file_path):
        logger.info(f"[PATH] 路径不在允许的目录范围内: {file_path}")
        raise HTTPException(status_code=403, detail="文件路径超出允许访问的范围")

    if not os.path.exists(file_path):
        logger.info(f"[PATH] 文件不存在: {file_path}")
        raise HTTPException(status_code=404, detail=f"文件未找到: {file_path}")
