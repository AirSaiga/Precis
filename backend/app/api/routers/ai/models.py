"""
@fileoverview AI API 请求/响应 Pydantic 模型定义模块

功能概述:
- 定义 AI 聊天、Provider 管理、配置生成等 API 的输入输出模型
- 提供硬件诊断相关的数据模型
- 支持异步任务的创建、状态、结果模型

架构设计:
- 按功能区域分块：Provider 管理、配置生成、异步任务、硬件诊断
- 所有模型继承自 Pydantic BaseModel，支持自动校验和序列化
- 使用 Field 定义字段描述和默认值

输入示例:
    class ConfigGenerateRequest(BaseModel):
        file_paths: list[str]
        project_name: str
        options: ConfigGenerateOptions = Field(default_factory=ConfigGenerateOptions)

输出示例:
    class ConfigGenerateResponse(BaseModel):
        success: bool
        yaml_preview: str
        manifest: Optional[dict[str, Any]] = None
"""

from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field

# =============================================================================
# Provider 管理模型
# =============================================================================


class ChatMessageInput(BaseModel):
    """聊天消息输入"""

    role: str
    content: str


class ChatRequestInput(BaseModel):
    """聊天请求输入"""

    provider_id: Optional[str] = Field(default=None, description="指定 Provider，不指定则使用默认")
    messages: list[ChatMessageInput]
    stream: bool = False
    model: Optional[str] = Field(default=None, description="覆盖默认模型")
    temperature: float = 0.7


class ChatResponseOutput(BaseModel):
    """聊天响应输出"""

    content: str
    model: str


class AiChatContextNode(BaseModel):
    """AI Chat 上下文节点"""

    id: str
    type: str
    data: dict[str, Any]
    label: Optional[str] = None


class AiChatContext(BaseModel):
    """AI Chat 上下文"""

    hasContext: bool
    selectedNodes: list[AiChatContextNode]


class AiChatHistoryMessage(BaseModel):
    """AI Chat 历史消息"""

    role: str
    content: str


class AiChatRequest(BaseModel):
    """AI Chat 请求输入 (对应前端请求)"""

    message: str
    context: AiChatContext
    history: Optional[list[AiChatHistoryMessage]] = None


class AiChatResponse(BaseModel):
    """AI Chat 响应输出 (对应前端期望)"""

    status: str
    reply: str
    actions: list[Any]
    frontend_instructions: list[Any]
    error: Optional[str] = None


class ProviderResponse(BaseModel):
    """Provider 响应"""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    name: str
    provider: str = Field(alias="type")
    deployment: str
    base_url: str
    model: str
    health: dict[str, Any]
    is_configured: bool = False


class DiscoverResponse(BaseModel):
    """发现服务响应"""

    services: list[dict[str, Any]]
    count: int


class TestProviderResponse(BaseModel):
    """测试 Provider 响应"""

    provider_id: str
    health: dict[str, Any]
    available_models: list[str]


class CreateProviderRequest(BaseModel):
    """创建 Provider 请求"""

    name: str = Field(..., description="显示名称")
    type: str = Field(default="openai", description="Provider 类型（openai 或 ollama）")
    base_url: str = Field(..., description="API 基础 URL")
    api_key: Optional[str] = Field(default=None, description="API 密钥，本地服务可留空")
    model: str = Field(..., description="默认模型名称")


class UpdateProviderRequest(BaseModel):
    """更新 Provider 请求（所有字段可选，仅传递需要更新的字段）"""

    name: Optional[str] = Field(default=None, description="显示名称")
    type: Optional[str] = Field(default=None, description="Provider 类型")
    base_url: Optional[str] = Field(default=None, description="API 基础 URL")
    api_key: Optional[str] = Field(default=None, description="API 密钥，传空字符串表示清空")
    model: Optional[str] = Field(default=None, description="默认模型名称")


class ProviderPresetResponse(BaseModel):
    """服务商预设响应"""

    id: str
    name: str
    type: str
    base_url: str
    default_model: str
    models: list[str]


# =============================================================================
# 配置生成模型 (新架构)
# =============================================================================


class ConfigGenerateOptions(BaseModel):
    """配置生成选项"""

    sample_rows: int = Field(default=100, description="每文件采样行数")
    sample_values_per_column: int = Field(default=100, description="每列采样值数量")
    max_files: int = Field(default=50, description="最大处理文件数")
    max_cell_chars: int = Field(default=500, description="单元格最大字符数")
    generate_schemas: bool = Field(default=True, description="生成表结构")
    generate_constraints: bool = Field(default=True, description="生成约束规则")
    generate_regex_nodes: bool = Field(default=False, description="生成正则节点")
    keep_existing: bool = Field(default=True, description="保留现有配置")
    target_files: Optional[list[str]] = Field(default=None, description="指定目标文件")


class ConfigGenerateRequest(BaseModel):
    """配置生成请求"""

    file_paths: list[str] = Field(..., description="数据文件路径列表")
    project_name: str = Field(..., description="项目名称")
    project_id: str = Field(..., description="项目标识")
    provider_id: Optional[str] = Field(default=None, description="指定AI Provider，不指定使用默认")
    options: ConfigGenerateOptions = Field(default_factory=ConfigGenerateOptions)


class ConfigGenerateResponse(BaseModel):
    """配置生成响应（同步）"""

    success: bool
    yaml_preview: str = Field(..., description="生成的配置YAML预览")
    manifest: Optional[dict[str, Any]] = Field(default=None, description="项目清单")
    schemas: Optional[dict[str, Any]] = Field(default=None, description="表结构定义")
    constraints: Optional[dict[str, Any]] = Field(default=None, description="约束规则")
    regex_nodes: Optional[dict[str, Any]] = Field(default=None, description="正则节点")
    warnings: list[str] = Field(default_factory=list)
    error: Optional[str] = None


# =============================================================================
# 异步任务模型
# =============================================================================


class ConfigGenerateJobCreateResponse(BaseModel):
    """配置生成任务创建响应"""

    job_id: str


class ConfigGenerateJobStatus(BaseModel):
    """配置生成任务状态"""

    job_id: str
    status: str = Field(..., description="pending/running/completed/failed/cancelled")
    stage: Optional[str] = Field(default=None, description="当前阶段")
    message: Optional[str] = Field(default=None, description="状态消息")
    progress: Optional[float] = Field(default=None, description="进度 0-100")
    created_at: str
    updated_at: str
    warnings: list[str] = Field(default_factory=list)
    error: Optional[str] = None
    result: Optional[ConfigGenerateResponse] = None


# =============================================================================
# 硬件诊断模型
# =============================================================================


class HardwareInfo(BaseModel):
    """硬件信息"""

    name: str
    value: Any


class HardwareRequirement(BaseModel):
    """硬件需求检查项"""

    name: str
    required: str
    current: Optional[str] = None
    satisfied: bool = False


class HardwareDiagnoseResponse(BaseModel):
    """硬件诊断响应"""

    platform: str
    cpu: Optional[HardwareInfo] = None
    memory: Optional[HardwareInfo] = None
    disk: Optional[HardwareInfo] = None
    gpu: Optional[list[HardwareInfo]] = None
    requirements: list[HardwareRequirement] = Field(default_factory=list)
    recommendations: list[str] = Field(default_factory=list)
