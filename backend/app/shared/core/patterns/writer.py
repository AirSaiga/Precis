r"""
@fileoverview Pattern YAML 写入模块

功能概述:
- 将 Pattern 数据模型序列化为 YAML 文件并写入 patterns/ 目录
- 支持自动创建目录和生成安全的文件名
- 提供 Pattern 存在性检查和唯一名称生成功能

架构设计:
- 数据验证: 使用 Pydantic BaseModel 确保 Pattern 数据符合规范
- 安全写入: 使用 write_yaml 进行安全的 YAML 序列化
- 文件名处理: 自动清理不合法字符，解决命名冲突

PatternFile 数据模型:
    name: str - Pattern 名称（必需）
    regex: str - 正则表达式（必需）
    description: Optional[str] - 描述信息（可选）
    output: Optional[Dict[str, Any]] - 输出配置（可选）

使用示例:
    # 保存 Pattern 文件
    pattern = PatternFile(name="email", regex=r"[\w\.]+@[\w\.]+", description="邮箱验证")
    filepath = save_pattern_file(pattern, "patterns")

    # 检查是否存在
    exists = check_pattern_exists("patterns", "email")

    # 生成唯一名称
    unique_name = generate_unique_pattern_name("patterns", "email")
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

from ..io.yaml import write_yaml


class PatternFile(BaseModel):
    """
    Pattern 文件格式的数据模型。

    使用 Pydantic 进行数据验证，确保写入的 Pattern 数据符合规范。
    所有字段都有描述信息，便于文档生成和 IDE 提示。

    字段说明：
        name: Pattern 的唯一标识名称，用于在 Registry 中检索
        regex: 正则表达式字符串，定义匹配规则
        description: 可选的描述信息，说明 Pattern 的用途
        output: 可选的输出配置，定义解析器的输出格式
    """

    # Pattern 名称，用于唯一标识
    name: str = Field(..., description="Pattern 名称")

    # 正则表达式字符串
    regex: str = Field(..., description="正则表达式")

    # 可选的描述信息
    description: str | None = Field(None, description="描述信息")

    # 可选的输出配置字典
    output: dict[str, Any] | None = Field(None, description="输出配置")


def save_pattern_file(pattern: PatternFile, patterns_dir: str, filename: str | None = None) -> str:
    r"""
    保存 Pattern 文件到 patterns 目录。

    将 PatternFile 对象序列化为 YAML 格式并写入文件。
    支持自动生成安全的文件名，并创建必要的目录。

    :param pattern: Pattern 数据模型对象
    :param patterns_dir: patterns 目录路径
    :param filename: 可选的文件名，默认使用 pattern.name + ".yaml"
    :return: 保存的文件完整路径

    处理流程：
        1. 确定文件名（如果未提供，从 pattern.name 生成）
        2. 创建 patterns_dir 目录（如果不存在）
        3. 拼接完整的文件路径
        4. 使用 Pydantic model_dump 导出数据
        5. 调用 write_yaml 写入文件

    文件名安全处理：
        - 只保留字母、数字、短横线(-)和下划线(_)
        - 其他字符替换为下划线(_)
        - 例如："My Pattern!" 转换为 "My_Pattern_.yaml"

    示例：
        >>> pattern = PatternFile(name="phone", regex=r"\d{3}-\d{4}")
        >>> filepath = save_pattern_file(pattern, "data/patterns")
        >>> print(f"已保存到: {filepath}")
    """
    # 如果未提供文件名，从 pattern.name 生成安全的文件名
    if filename is None:
        # 安全处理：将不合法字符替换为下划线
        # isalnum(): 检查字符是否为字母或数字
        safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in pattern.name)
        filename = f"{safe_name}.yaml"

    # 创建 patterns 目录（如果不存在）
    # exist_ok=True: 如果目录已存在，不抛出异常
    os.makedirs(patterns_dir, exist_ok=True)

    # 拼接完整的文件路径
    filepath = os.path.join(patterns_dir, filename)

    # 使用 Pydantic 导出数据，排除 None 值
    # exclude_none=True: 不写入值为 None 的字段
    data = pattern.model_dump(exclude_none=True)

    # 调用 write_yaml 写入文件
    write_yaml(Path(filepath), data)

    # 返回完整的文件路径
    return filepath


def check_pattern_exists(patterns_dir: str, pattern_name: str) -> bool:
    """
    检查指定名称的 Pattern 文件是否已存在。

    用于判断是否需要创建新文件，或者是否会覆盖已有文件。

    :param patterns_dir: patterns 目录路径
    :param pattern_name: Pattern 名称
    :return: 如果文件存在返回 True，否则返回 False

    处理流程：
        1. 检查 patterns_dir 是否为有效目录
        2. 从 pattern_name 生成安全的文件名
        3. 检查文件是否存在

    文件名生成规则与 save_pattern_file 一致：
        - 只保留字母、数字、短横线和下划线
        - 其他字符替换为下划线

    示例：
        >>> if check_pattern_exists("patterns", "email"):
        ...     print("Pattern 已存在")
        ... else:
        ...     print("可以创建新 Pattern")
    """
    # 检查目录是否存在
    if not os.path.isdir(patterns_dir):
        # 目录不存在，Pattern 文件必然不存在
        return False

    # 生成安全的文件名
    safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in pattern_name)

    # 拼接文件路径
    filepath = os.path.join(patterns_dir, f"{safe_name}.yaml")

    # 检查文件是否存在并返回结果
    return os.path.isfile(filepath)


def generate_unique_pattern_name(patterns_dir: str, base_name: str) -> str:
    """
    生成唯一的 Pattern 名称，处理命名冲突。

    如果 base_name 已存在，会自动在名称后添加数字后缀，
    直到找到不冲突的名称。例如：email, email_1, email_2, ...

    :param patterns_dir: patterns 目录路径
    :param base_name: 基础名称
    :return: 唯一的名称（如果基础名称可用则返回原名称，否则返回带数字后缀的名称）

    处理流程：
        1. 首先检查 base_name 是否可用
        2. 如果不可用，从 1 开始递增尝试
        3. 找到第一个不存在的名称后返回

    示例：
        >>> generate_unique_pattern_name("patterns", "email")
        'email'  # 如果 email 不存在

        >>> generate_unique_pattern_name("patterns", "email")
        'email_3'  # 如果 email, email_1, email_2 都已存在
    """
    # 首先检查基础名称是否可用
    if not check_pattern_exists(patterns_dir, base_name):
        return base_name

    # 基础名称已存在，从 1 开始尝试
    counter = 1

    # 循环尝试，直到找到不存在的名称
    while True:
        # 生成带数字后缀的名称
        new_name = f"{base_name}_{counter}"

        # 检查新名称是否可用
        if not check_pattern_exists(patterns_dir, new_name):
            return new_name

        # 继续尝试下一个数字
        counter += 1


def get_pattern_filepath(patterns_dir: str, pattern_name: str) -> str:
    """根据 pattern 名称推导其文件路径（与 save 的命名规则一致）。

    :param patterns_dir: patterns 目录路径
    :param pattern_name: Pattern 名称
    :return: 完整文件路径
    """
    safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in pattern_name)
    return os.path.join(patterns_dir, f"{safe_name}.yaml")


def delete_pattern_file(patterns_dir: str, pattern_name: str) -> bool:
    """删除指定 Pattern 文件。

    :param patterns_dir: patterns 目录路径
    :param pattern_name: Pattern 名称
    :return: 删除成功返回 True，文件不存在返回 False
    """
    filepath = get_pattern_filepath(patterns_dir, pattern_name)
    if not os.path.isfile(filepath):
        return False
    os.remove(filepath)
    return True
