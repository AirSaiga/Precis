"""
@fileoverview V2 配置响应模型

功能概述:
- 定义 V2 项目配置 API 响应相关的 Pydantic 数据模型
- 将内部配置模型与 API 响应契约解耦，保持 API 兼容性

输入示例:
    内部 ProjectManifestV2 模型实例

输出示例:
    ManifestResponse(
        version=2,
        project=ProjectInfo(id="proj", name="Project"),
        schemas=[...],
        constraints=[...]
    )
"""

from app.shared.core.project.manifest.types import ProjectManifestV2


class ManifestResponse(ProjectManifestV2):
    """
    /v2/manifest GET 的 API 响应模型。

    当前继承自 ProjectManifestV2 以保持兼容性，
    后续可按需添加/移除字段，或在此做数据转换。
    """

    pass
