"""
@fileoverview 正则节点读取模块

功能概述:
- 从 *.regex.yaml 文件读取正则节点配置
- 解析正则表达式（支持引用模式和直接模式）

架构设计:
- 唯一入口: 该模块是 Regex 节点配置读取的唯一入口
- 双模式支持: load_regex_node 加载配置，resolve_regex_pattern 解析表达式
- 读写配合: 与 writer.py 配合实现正则节点配置全生命周期管理

输入示例:
    # phone.regex.yaml
    version: 2
    id: phone
    name: 手机号校验
    uses_pattern:
      registry: patterns
      pattern_name: phone_cn

输出示例:
    regex_node = load_regex_node("regex/phone.regex.yaml")
    pattern = resolve_regex_pattern(regex_node, patterns_registry)
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import TYPE_CHECKING, cast

from pydantic import ValidationError

from app.shared.core.io.yaml import read_yaml

from .types import RegexNodeFile

if TYPE_CHECKING:
    from .types import RegexNodeFile


def load_regex_node(regex_path: str | Path) -> RegexNodeFile:
    """
    @methoddesc 从 YAML 文件加载正则节点配置。

    处理流程：
    1. 将路径转换为 Path 对象
    2. 调用 YAML 读取工具读取文件内容
    3. 使用 Pydantic 模型验证配置有效性
    4. 返回验证后的 RegexNodeFile 对象

    :param regex_path: regex 文件路径，可以是相对路径或绝对路径
    :return: RegexNodeFile 对象，包含正则节点的完整配置
    :raises ValueError: 文件不存在、格式错误或验证失败
    :raises FileNotFoundError: 文件路径不存在
    """
    # 步骤1：转换为 Path 对象（统一处理路径格式）
    path = Path(regex_path)

    # 步骤2：读取 YAML 文件内容
    # read_yaml 会解析 YAML 文件并返回字典结构
    raw = read_yaml(path)

    # 步骤3：使用 Pydantic 进行数据验证
    # model_validate 会检查所有字段是否符合类型和约束要求
    try:
        return RegexNodeFile.model_validate(raw)
    except ValidationError as e:
        # 包装验证错误，提供更友好的错误信息
        raise ValueError(f"regex_node 校验失败: {path}\n{e}") from e


def find_pattern_by_name(registry, pattern_name: str):
    """
    @methoddesc 按名称从注册表中查找表达式模式。

    处理流程：
    1. 遍历注册表中所有已注册的模式
    2. 匹配模式名称
    3. 返回第一个匹配的模式，或 None

    :param registry: ExpressionRegistry 实例，包含已注册的模式列表
    :param pattern_name: 要查找的模式名称
    :return: 找到的 ExpressionPattern 对象，或 None（未找到）
    """
    # 遍历所有已注册的模式，查找名称匹配的对象
    # _patterns 是注册表内部的模式列表
    for pattern in registry._patterns:
        if pattern.name == pattern_name:
            return pattern
    # 未找到匹配的模式，返回 None
    return None


def resolve_regex_pattern(regex_config: RegexNodeFile, registries: dict) -> re.Pattern:
    """
    @methoddesc 解析正则节点的正则表达式。

    根据配置模式（引用模式或直接模式）获取并编译正则表达式。
    引用模式支持配置覆盖（pattern_overrides），如修改 flags 等。

    处理流程（引用模式）：
    1. 检查是否使用引用模式（uses_pattern 字段）
    2. 从 registries 获取 expression_registry
    3. 根据 pattern_name 在注册表中查找表达式
    4. 如果存在 pattern_overrides，应用覆盖配置（如 flags）
    5. 返回编译后的正则表达式对象

    处理流程（直接模式）：
    1. 检查是否使用直接模式（pattern 字段）
    2. 直接编译 pattern 字段中的正则表达式
    3. 返回编译后的正则表达式对象

    :param regex_config: regex 节点配置，包含正则表达式定义
    :param registries: 包含 expression_registry 的字典
    :return: 编译后的正则表达式对象（re.Pattern 类型）
    :raises ValueError: 注册表未加载、模式未找到或配置错误
    """
    # 判断使用哪种模式
    if regex_config.uses_pattern:
        # ========== 引用模式处理流程 ==========
        # 步骤1：获取要引用的模式名称
        pattern_name = regex_config.uses_pattern.pattern_name

        # 步骤2：从注册表字典中获取表达式注册表
        registry = registries.get("expression_registry")

        # 步骤3：检查注册表是否已加载
        if registry is None:
            raise ValueError("未加载注册表：expression_registry")

        # 步骤4：在注册表中查找指定的表达式模式
        pattern = find_pattern_by_name(registry, pattern_name)
        if pattern is None:
            raise ValueError(
                f"在 patterns 目录中未找到表达式模式：'{pattern_name}'（请检查 patterns/ 目录中的 YAML 文件）"
            )

        # 步骤5：获取原始正则表达式
        effective_pattern = pattern.regex.pattern

        # 步骤6：检查是否有配置覆盖（允许修改 flags 等）
        overrides = regex_config.pattern_overrides or {}
        if "flags" in overrides:
            # 存在 flags 覆盖，需要重新编译
            import re as re_module

            flags = 0
            flag_str = str(overrides["flags"])

            # 解析 flags 字符串，支持多种格式：
            # - 短格式："i" -> IGNORECASE
            # - 长格式："ignorecase" -> IGNORECASE
            # - 组合："im" -> IGNORECASE | MULTILINE

            if "i" in flag_str or "ignorecase" in flag_str.lower():
                flags |= re_module.IGNORECASE
            if "m" in flag_str or "multiline" in flag_str.lower():
                flags |= re_module.MULTILINE
            if "s" in flag_str or "dotall" in flag_str.lower():
                flags |= re_module.DOTALL

            # 使用覆盖后的 flags 重新编译
            return re_module.compile(effective_pattern, flags)

        # 步骤7：无覆盖时返回原始编译后的正则表达式
        return cast(re.Pattern, pattern.regex)

    # ========== 直接模式处理流程 ==========
    # 检查是否配置了直接模式的正则表达式
    if not regex_config.pattern:
        raise ValueError("regex_node 必须指定 pattern 或 uses_pattern")

    # 解析 flags（与引用模式的 pattern_overrides 分支保持一致）
    # 过去直接模式完全忽略 regex_config.flags / case_sensitive，导致大小写等配置失效
    flags = 0
    flag_str = str(getattr(regex_config, "flags", "") or "")
    if "i" in flag_str or "ignorecase" in flag_str.lower():
        flags |= re.IGNORECASE
    if "m" in flag_str or "multiline" in flag_str.lower():
        flags |= re.MULTILINE
    if "s" in flag_str or "dotall" in flag_str.lower():
        flags |= re.DOTALL
    # case_sensitive=False 同样触发 IGNORECASE（与 RegexConstraint 语义一致）
    if getattr(regex_config, "case_sensitive", True) is False:
        flags |= re.IGNORECASE

    # 直接编译 pattern 字段中的正则表达式
    return re.compile(regex_config.pattern, flags)
