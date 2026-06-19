# backend/app/api/models/__init__.py
"""
@fileoverview API 模型包入口

功能概述:
- 作为 API 数据模型的统一出口，聚合所有子模块的模型定义
- 通过从子模块导入再导出的方式，保持向后兼容性
- 定义 __all__ 公开 API 列表

输入示例:
    from app.api.models import ProjectDetail, WorkspaceConfig, FullValidationResponse

输出示例:
    可直接访问所有聚合的模型类：
    - ProjectDetail, ProjectConfigModel, PathsModel, StandardResponse
    - EndpointModel, ConnectionRuleModel, ConnectionRuleConfigModel, ConnectionRulesModel
    - ExternalDataSource, WorkspaceConfig, UIPreferences
    - SchemaSaveRequest, SchemaSaveResponse, HeaderRowChangedRequest
    - FilePreviewResponse
    - ValidationRequest, ValidationResponse, ValidationType
    - FullValidationRequest, FullValidationResponse, FullValidationSummary
"""

# 从各子模块导入模型，保持向后兼容
# ============================================================================
# 项目配置模型
# ============================================================================
# ============================================================================
# 连接规则模型
# ============================================================================
from .connection_rules import (
    ConnectionRuleConfigModel,
    ConnectionRuleModel,
    ConnectionRulesModel,
    EndpointModel,
)

# ============================================================================
# 全量校验模型
# ============================================================================
from .full_validation import (
    FullValidationErrorItem,
    FullValidationOptions,
    FullValidationRequest,
    FullValidationResponse,
    FullValidationSummary,
    ValidationPassedItem,
    ValidationStatistics,
)

# ============================================================================
# 数据预览模型
# ============================================================================
from .preview import (
    FilePreviewResponse,
)
from .project import (
    PathsModel,
    ProjectConfigModel,
    ProjectDetail,
    StandardResponse,
)

# ============================================================================
# Schema 操作模型
# ============================================================================
from .schema import (
    HeaderRowChangedRequest,
    HeaderRowChangedResponse,
    SchemaSaveRequest,
    SchemaSaveResponse,
)

# ============================================================================
# 校验模型
# ============================================================================
from .validation import (
    InlineValidationRequest,
    RegexValidationErrorRow,
    RegexValidationRequest,
    RegexValidationResponse,
    RegexValidationResult,
    ValidationErrorRow,
    ValidationRequest,
    ValidationResponse,
    ValidationResult,
    ValidationType,
)

# ============================================================================
# 工作区模型
# ============================================================================
from .workspace import (
    ExternalDataSource,
    UIPreferences,
    WorkspaceConfig,
)

# 定义公开的 API 列表
__all__ = [
    # 项目配置模型
    "ProjectDetail",
    "PathsModel",
    "ProjectConfigModel",
    "StandardResponse",
    # 连接规则模型
    "EndpointModel",
    "ConnectionRuleConfigModel",
    "ConnectionRuleModel",
    "ConnectionRulesModel",
    # 工作区模型
    "ExternalDataSource",
    "UIPreferences",
    "WorkspaceConfig",
    # Schema 操作模型
    "SchemaSaveRequest",
    "SchemaSaveResponse",
    "HeaderRowChangedRequest",
    "HeaderRowChangedResponse",
    # 数据预览模型
    "FilePreviewResponse",
    # 校验模型
    "InlineValidationRequest",
    "RegexValidationRequest",
    "RegexValidationResponse",
    "RegexValidationResult",
    "RegexValidationErrorRow",
    "ValidationRequest",
    "ValidationResponse",
    "ValidationResult",
    "ValidationErrorRow",
    "ValidationType",
    # 全量校验模型
    "FullValidationRequest",
    "FullValidationOptions",
    "FullValidationSummary",
    "FullValidationErrorItem",
    "FullValidationResponse",
    "ValidationPassedItem",
    "ValidationStatistics",
]
