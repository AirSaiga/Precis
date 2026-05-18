"""
@fileoverview 验证设置类型定义模块

功能概述:
- 定义数据验证相关的配置选项
- 包括自动验证、严格模式、错误处理、超时等

架构设计:
- 类型安全: 使用 Literal 限制可选值
- 范围限制: timeout_seconds 和 batch_max_files 有取值范围
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class ValidationSettings(BaseModel):
    """
    @classdesc 验证设置

    定义数据验证的行为和策略。

    字段说明:
        - auto_validate: 是否在连接或配置变更时自动触发校验
        - strict_mode: 严格模式，任何错误都会导致校验失败
        - error_handling: 遇到错误时的处理策略
            - stop: 立即停止校验
            - continue: 跳过错误继续校验其他数据
            - report: 记录错误但继续，生成完整报告
        - timeout_seconds: 单次校验最大超时时间 (1-300秒)
        - batch_max_files: 批量校验的最大文件数 (1-1000)

    输入示例 (manifest.yaml):
        settings:
          validation:
            auto_validate: true
            strict_mode: false
            error_handling: continue
            timeout_seconds: 60
            batch_max_files: 200

    输出示例:
        ValidationSettings(
            auto_validate=True,
            strict_mode=False,
            error_handling="continue",
            timeout_seconds=60,
            batch_max_files=200
        )

    默认值:
        ValidationSettings(
            auto_validate=True,
            strict_mode=False,
            error_handling="continue",
            timeout_seconds=30,
            batch_max_files=100
        )
    """

    auto_validate: bool = Field(True, description="是否在连接或配置变更时自动执行校验")
    strict_mode: bool = Field(False, description="是否严格模式，发现任何错误即标记为校验失败")
    error_handling: Literal["stop", "continue", "report"] = Field("continue", description="遇到校验错误时的处理策略")
    timeout_seconds: int = Field(30, ge=1, le=300, description="单次校验的最大执行时间（秒）")
    batch_max_files: int = Field(100, ge=1, le=1000, description="批量校验的最大文件数量")
