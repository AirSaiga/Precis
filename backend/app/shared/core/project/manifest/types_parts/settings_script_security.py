"""
@fileoverview 脚本安全设置类型定义模块

功能概述:
- 定义脚本执行的安全策略
- 控制 eval/exec 的使用、沙箱模式、超时等

架构设计:
- 安全优先: 默认禁用危险函数
- 范围限制: timeout_seconds 有取值范围
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class ScriptSecuritySettings(BaseModel):
    """@classdesc 脚本安全设置

    定义脚本执行的权限和安全策略。

    字段说明:
        - allow_eval: 是否允许使用 eval() 函数 (危险! 可能执行任意代码)
        - allow_exec: 是否允许使用 exec() 函数 (危险! 可能执行任意代码)
        - sandbox_mode: 是否在沙箱环境中执行 (限制文件系统访问等)
        - timeout_seconds: 脚本最大执行时间 (1-60秒)

    原理说明:
        为什么默认禁用 eval/exec?
        - eval() 和 exec() 可以执行任意 Python 代码
        - 如果用户输入被拼接到这些函数中，可能导致代码注入攻击
        - 建议使用安全的表达式解析器代替

    输入示例 (manifest.yaml):
        settings:
          script_security:
            allow_eval: false
            allow_exec: false
            sandbox_mode: true
            timeout_seconds: 30

    输出示例:
        ScriptSecuritySettings(
            allow_eval=False,
            allow_exec=False,
            sandbox_mode=True,
            timeout_seconds=30
        )

    默认值 (最安全配置):
        ScriptSecuritySettings(
            allow_eval=False,
            allow_exec=False,
            sandbox_mode=True,
            timeout_seconds=10
        )
    """

    allow_eval: bool = Field(False, description="是否允许执行 Python eval() 函数")
    allow_exec: bool = Field(False, description="是否允许执行 Python exec() 函数")
    sandbox_mode: bool = Field(True, description="是否在受限环境中执行脚本")
    timeout_seconds: int = Field(10, ge=1, le=60, description="脚本单次执行的最大时间（秒）")
