"""@fileoverview AI 服务类型定义模块

功能概述:
- 定义 AI 配置生成所需的数据类型（ProfilingOptions、GenerateOptions 等）
- 提供 LLM Provider 配置和 Chat 相关数据类
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

# =============================================================================
# 模块常量
# =============================================================================

# Precis V2 项目清单文件名
# 所有 V2 项目使用统一的清单文件名称，便于识别和加载
V2_MANIFEST_FILENAME = "project.precis.yaml"


# =============================================================================
# 数据画像选项
# =============================================================================


@dataclass(frozen=True)
class ProfilingOptions:
    """
    @classdesc 数据画像选项配置类

    用于控制数据分析和样本提取的行为参数。这些选项决定了：
    - 从每个数据文件读取多少行进行分析
    - 每列提取多少样本值用于了解数据分布
    - 最多处理多少个数据文件
    - 单元格文本截断到多长

    设计考虑：
    - 使用 frozen=True 确保实例不可变，天然线程安全
    - 所有字段有默认值，支持最小化配置
    - 数值型默认值经过实践验证，在内存使用和分析精度间取得平衡

    Attributes:
        sample_rows: 从每个数据文件读取的最大行数
                     用于生成数据画像供 AI 分析
                     默认值 50 行 - 在内存使用和代表性之间取得平衡
                     较大值可获得更准确的分析，但消耗更多内存
        sample_values_per_column: 每列提取的样本值数量
                                  用于了解数据分布和枚举值
                                  默认值 10 个样本
                                  对于枚举型字段可适当增加
        max_files: 最多处理的数据文件数量
                   防止资源耗尽和过长处理时间
                   默认值 50 个文件
                   批量处理大量文件时可调整
        max_cell_chars: 单个单元格文本的最大保留字符数
                        超过部分将被截断为 "..."
                        默认值 200 字符
                        长文本分析可适当增加

    Example:
        >>> # 使用默认选项
        >>> opts = ProfilingOptions()
        >>>
        >>> # 自定义选项
        >>> opts = ProfilingOptions(
        ...     sample_rows=100,
        ...     sample_values_per_column=20,
        ...     max_files=10,
        ...     max_cell_chars=500
        ... )
    """

    sample_rows: int = 50
    sample_values_per_column: int = 10
    max_files: int = 50
    max_cell_chars: int = 200


# =============================================================================
# 配置生成选项
# =============================================================================


@dataclass(frozen=True)
class GenerateOptions:
    """
    @classdesc 配置生成选项配置类

    用于控制 V2 配置生成的行为参数。这些选项决定：
    - 生成哪些类型的配置（schema、约束、正则节点）
    - 如何处理现有配置（保留或覆盖）
    - 使用哪个 AI 模型
    - 仅处理哪些文件

    设计考虑：
    - 使用 frozen=True 确保实例不可变，天然线程安全
    - 生成类选项默认为 True，保留现有配置默认为 True
    - 提供细粒度控制能力

    Attributes:
        generate_schemas: 是否生成表结构定义（schema）
                          启用后将为每个数据文件创建 TableSchemaFileV2
                          包含列名、数据类型等信息
                          默认值 True
        generate_constraints: 是否生成约束规则
                             启用后将调用 AI 生成约束建议
                             注意：当前版本约束生成功能未完全实现
                             默认值 True
        generate_regex_nodes: 是否生成正则节点
                              启用后将调用 AI 生成正则建议
                              注意：当前版本正则节点生成功能未完全实现
                              默认值 True
        keep_existing: 是否保留现有配置
                       True 时会合并现有配置，新生成内容将追加到现有内容
                       False 时会清空并重新生成所有内容
                       适用于增量更新特定文件的场景
                       默认值 True
        model: 使用的 Ollama 模型名称
               用于生成约束和正则节点建议
               未指定时使用环境变量 PRECIS_OLLAMA_MODEL
               需要确保指定的模型已在本地安装
               默认值 None（使用环境变量）
        target_files: 仅处理指定的数据文件列表
                      用于增量更新特定文件
                      如果为 None 或空列表，则处理所有文件
                      路径应为绝对路径或相对于工作目录的路径
                      默认值 None（处理所有文件）

    Example:
        >>> # 使用默认选项
        >>> opts = GenerateOptions()
        >>>
        >>> # 仅生成 schema
        >>> opts = GenerateOptions(
        ...     generate_schemas=True,
        ...     generate_constraints=False,
        ...     generate_regex_nodes=False
        ... )
        >>>
        >>> # 使用特定模型并处理指定文件
        >>> opts = GenerateOptions(
        ...     model="qwen:7b",
        ...     target_files=["/data/users.csv", "/data/orders.csv"]
        ... )
    """

    generate_schemas: bool = True
    generate_constraints: bool = True
    generate_regex_nodes: bool = True
    keep_existing: bool = True
    model: str | None = None
    target_files: list[str] | None = None


# =============================================================================
# AI Chat 相关类型
# =============================================================================


@dataclass
class ChatContext:
    """
    @classdesc AI Chat 上下文数据类

    用于传递项目上下文信息给 AI。

    Attributes:
        has_context: 是否有上下文
        selected_nodes: 选中的节点列表
        project_overview: 项目概览（表结构和约束）
    """

    has_context: bool = False
    selected_nodes: list[dict[str, Any]] = field(default_factory=list)
    project_overview: dict[str, Any] = field(default_factory=dict)


@dataclass
class ChatResult:
    """
    @classdesc AI Chat 执行结果数据类

    统一 API 和 CLI 的结果格式。

    Attributes:
        success: 是否成功
        reply: AI 回复文本
        actions: 解析出的动作列表
        frontend_instructions: 前端渲染指令
        error: 错误信息（如果有）
    """

    success: bool
    reply: str
    actions: list[dict[str, Any]] = field(default_factory=list)
    frontend_instructions: list[Any] = field(default_factory=list)
    error: str | None = None
