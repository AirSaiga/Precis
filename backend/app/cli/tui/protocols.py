"""TUI service 层共享协议。

本模块定义 P1-P5 各任务包必须遵守的接口契约：

- ``ProjectState``：TUI 全局项目状态协议。各 service 读写此状态以获取/更新
  当前打开的项目路径与配置。App（或其注入的上下文）需实现该协议并传递给 service。
- ``register_screen``：屏幕注册装饰器。P1-P5 的 Screen 类用它把自己注册到
  ``SCREEN_REGISTRY``，P6 的 app.py 遍历该字典完成装配。

> 注意：P1-P5 发现协议不足时，**不能修改本公共文件**，应在自己的 service 内扩展，
> 由 P6 统一回填。本文件内容在 P0a 冻结后即视为接口契约。
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Protocol

if TYPE_CHECKING:
    from collections.abc import Callable


class ProjectState(Protocol):
    """TUI 全局项目状态协议。

    实现方（通常是 App 或其持有的上下文对象）需提供以下可读写属性与只读属性，
    供各 service 查询当前打开的项目。实现方可在此基础上追加更多字段。
    """

    # 当前打开项目的根路径，未打开时为 None
    project_path: str | None
    # 当前打开项目的清单配置（已加载为 dict），未打开或未加载时为 None
    project_config: dict[str, Any] | None

    @property
    def is_project_open(self) -> bool:
        """是否已打开项目（project_path 非空即视为已打开）。"""
        ...


# 屏幕注册表：name -> Screen 类。P1-P5 各自注册自己的屏，P6 的 app.py 遍历装配。
SCREEN_REGISTRY: dict[str, type] = {}

# 屏的功能顺序（用于侧边栏排列、过渡方向判断）。
# 未列在此处的屏按字母序追加在末尾。
SCREEN_ORDER: list[str] = [
    "dashboard",
    "validation",
    "provider",
    "config",
    "chat",
    "generate",
    "migrate",
]


def register_screen(name: str) -> Callable[[type], type]:
    """装饰器：将 Screen 类注册到 SCREEN_REGISTRY。

    P1-P5 的每个 Screen 类用它登记名称，P6 的 app.py 通过
    ``SCREEN_REGISTRY`` 获取全部屏并装配（绑定快捷键、命令面板跳转等）。

    Args:
        name: 屏的注册名（如 "validation"、"provider"），需全局唯一。

    Example:
        >>> @register_screen("validation")
        ... class ValidationScreen(Screen): ...
    """

    def decorator(cls: type) -> type:
        SCREEN_REGISTRY[name] = cls
        return cls

    return decorator
