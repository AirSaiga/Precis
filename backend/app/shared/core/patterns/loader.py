"""@fileoverview 表达式模式加载模块

功能概述:
- 从 patterns/ 目录加载 YAML 规则文件并编译为正则表达式
- 将 ExpressionPattern 注册到 ExpressionRegistry 供系统使用
"""

from __future__ import annotations

import logging
import os
import re

logger = logging.getLogger(__name__)
from pathlib import Path
from typing import TYPE_CHECKING

from ...domain.expression_system import ExpressionPattern, ExpressionRegistry, create_tempated_parser
from ..io.yaml import read_yaml

if TYPE_CHECKING:
    from ...domain.expression_system import ExpressionRegistry


def load_patterns_from_config(base_dir: str) -> ExpressionRegistry:
    """
    从指定的配置目录加载所有 YAML 规则文件。

    本函数遍历指定目录下的所有 .yaml 和 .yml 文件，
    将每个文件解析为 ExpressionPattern 并注册到 ExpressionRegistry。

    加载流程：
        1. 检查目录是否存在，不存在则返回空 Registry
        2. 遍历目录下的所有 YAML 文件（按文件名排序）
        3. 读取并解析每个 YAML 文件
        4. 验证必需字段（name, regex）
        5. 创建 ExpressionPattern 对象
        6. 注册到 Registry

    :param base_dir: 包含 .yaml 规则文件的目录路径，可以是相对路径或绝对路径
    :return: 填充了所有已加载规则的 ExpressionRegistry 实例

    YAML 文件要求：
        - 必须包含 name 字段：规则名称，用于唯一标识
        - 必须包含 regex 字段：正则表达式字符串
        - 可选包含 description 字段：描述信息
        - 可选包含 output 字段：输出配置字典

    错误处理：
        - 无名称的规则文件会被跳过并输出警告
        - 无正则的规则文件会被跳过并输出警告
        - 加载失败的文件会输出错误信息并继续处理其他文件

    示例：
        >>> registry = load_patterns_from_config("data/patterns")
        >>> print(f"已加载 {len(registry.patterns)} 条规则")
    """
    # 创建空的 ExpressionRegistry 实例
    # 用于存储所有加载的表达式模式
    registry = ExpressionRegistry()

    logger.debug(f"开始从 '{base_dir}' 加载表达式规则...")

    # 检查目录是否存在
    if not os.path.isdir(base_dir):
        # 目录不存在，输出信息并返回空 Registry
        logger.debug(f"目录不存在，跳过：'{base_dir}'")
        return registry

    # 遍历目录下的所有文件
    # 使用 sorted() 确保加载顺序一致，便于调试和复现
    for filename in sorted(os.listdir(base_dir)):
        # 只处理 .yaml 和 .yml 文件
        if filename.endswith((".yaml", ".yml")):
            # 拼接完整的文件路径
            filepath = os.path.join(base_dir, filename)

            try:
                # 读取 YAML 文件内容
                cfg = read_yaml(Path(filepath))

                # 提取并验证 name 字段
                name = cfg.get("name")
                if not name:
                    logger.warning(f"跳过无名称的规则文件：{filename}")
                    continue

                # 提取并验证 regex 字段
                regex_str = cfg.get("regex")
                if not regex_str:
                    logger.warning(f"跳过无正则的规则文件：{filename}")
                    continue

                # 创建模板化解析器工厂函数
                # output 字段可选，用于配置解析器的输出格式
                parser_factory = create_tempated_parser(cfg.get("output") or {})

                # 编译正则表达式为 Pattern 对象
                # 使用 re.compile 提高后续匹配的效率
                pattern = ExpressionPattern(name=name, regex=re.compile(regex_str), parser_func=parser_factory)

                # 将模式注册到 Registry
                registry.register(pattern)

                logger.debug(f"成功加载并注册了模板化表达式：'{name}'")

            except Exception as e:
                # 捕获加载过程中的所有异常
                # 输出错误信息但继续处理其他文件
                logger.warning(f"加载规则文件 '{filename}' 失败: {e}")

    logger.debug("表达式规则加载完成。")

    # 返回填充了规则的 Registry 实例
    return registry
