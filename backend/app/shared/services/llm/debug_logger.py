"""
@fileoverview AI 调试日志模块

功能概述:
- 为 AI 配置生成服务提供独立的文件日志记录
- 自动记录 Prompt、原始响应和解析后的 JSON 结果
- 支持通过 AI_DEBUG_LOG_PATH 环境变量自定义日志路径

架构设计:
- 独立 Logger: 使用名为 "ai_generator" 的 logging.Logger，与主应用日志隔离
- 自动初始化: 模块导入时自动创建文件处理器和格式化器
- 容错设计: 日志文件无法创建时回退到 NullHandler，避免阻塞业务

输入示例:
    log_ai_response(prompt="生成 Schema...", response="{...}", parsed_json="{...}")

输出示例:
    # 写入 ~/.precis/logs/ai_debug.log
    2024-01-01 12:00:00 - INFO - AI Generation Debug Log
    2024-01-01 12:00:00 - INFO - Prompt Length: 1200
    ...
"""

import logging
import os
from pathlib import Path

# 配置日志记录器
logger = logging.getLogger("ai_generator")
logger.setLevel(logging.DEBUG)

# 获取日志文件路径
# 优先使用环境变量 AI_DEBUG_LOG_PATH，否则使用默认路径 ~/.precis/logs/ai_debug.log
if os.environ.get("AI_DEBUG_LOG_PATH"):
    log_file_path = os.environ.get("AI_DEBUG_LOG_PATH")
else:
    # 使用用户主目录下的 .precis/logs 目录
    log_dir = Path.home() / ".precis" / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_file_path = log_dir / "ai_debug.log"

# 创建文件处理器，将日志写入指定路径
try:
    file_handler = logging.FileHandler(log_file_path, encoding="utf-8")
    file_handler.setLevel(logging.DEBUG)

    # 创建日志格式
    formatter = logging.Formatter("%(asctime)s - %(levelname)s - %(message)s")
    file_handler.setFormatter(formatter)

    # 添加处理器到记录器
    if not logger.handlers:
        logger.addHandler(file_handler)
except (OSError, PermissionError) as e:
    # 如果无法创建日志文件，使用 NullHandler 避免错误
    logger.addHandler(logging.NullHandler())
    logger.warning(f"无法创建日志文件 {log_file_path}: {e}")


def log_ai_response(prompt: str, response: str, parsed_json: str = None):
    """
    @methoddesc 记录 AI 响应调试日志

    将 Prompt、原始响应和解析后的 JSON 写入独立的日志文件，便于排查 AI 生成问题。

    参数:
        prompt: 发送给 AI 的 Prompt 文本
        response: AI 返回的原始响应文本
        parsed_json: 解析后的 JSON 字符串（可选）

    副作用:
        写入日志文件到 ~/.precis/logs/ai_debug.log
    """
    logger.info("=" * 50)
    logger.info("AI Generation Debug Log")
    logger.info("=" * 50)
    logger.info(f"Prompt Length: {len(prompt)}")
    logger.info("-" * 20 + " Prompt (Head 500) " + "-" * 20)
    logger.info(prompt[:500] + "..." if len(prompt) > 500 else prompt)
    logger.info("-" * 20 + " Raw Response " + "-" * 20)
    logger.info(response)
    if parsed_json:
        logger.info("-" * 20 + " Parsed JSON " + "-" * 20)
        logger.info(parsed_json)
    logger.info("=" * 50)
