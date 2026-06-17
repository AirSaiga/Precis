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
    agent_mode: bool = Field(default=True, description="是否启用 Agent 深度模式")


class AgentMeta(BaseModel):
    """Agent 模式执行元数据（仅 agent_mode=true 时填充）"""

    iterations: int = 0
    tool_steps: list[dict[str, Any]] = Field(default_factory=list, description="工具调用轨迹")


class AiChatResponse(BaseModel):
    """AI Chat 响应输出 (对应前端期望)"""

    status: str
    reply: str
    actions: list[Any]
    frontend_instructions: list[Any]
    agent_meta: Optional[AgentMeta] = None
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
    agent_mode: bool = Field(default=True, description="启用 Agent 多轮优化模式")
    max_iterations: int = Field(default=2, ge=1, le=5, description="Agent 最大迭代轮数")
    validation_sample_size: int = Field(default=1000, ge=100, le=10000, description="校验采样行数")
    auto_chunking: bool = Field(default=True, description="大数据量自动分块处理")
    chunk_max_columns: int = Field(default=20, ge=5, le=100, description="分块最大列数")
    chunk_max_files: int = Field(default=5, ge=1, le=20, description="分块最大文件数")


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
    iterations: Optional[int] = Field(default=None, description="Agent 迭代轮数")
    metrics: Optional[dict[str, Any]] = Field(default=None, description="Agent 校验指标")


class ConfigMigrateSource(BaseModel):
    """单个迁移脚本来源"""

    content: str = Field(..., description="脚本内容或自然语言描述")
    language: str = Field(default="python", description="脚本类型: python/natural_language/excel_formula/sql")
    name: Optional[str] = Field(default=None, description="来源名称或文件路径，用于展示")


class ConfigMigrateRequest(BaseModel):
    """配置迁移请求"""

    script_content: str = Field(default="", description="脚本内容或自然语言描述（兼容单来源）")
    language: str = Field(default="python", description="脚本类型: python/natural_language/excel_formula/sql")
    sources: Optional[list[ConfigMigrateSource]] = Field(default=None, description="批量脚本来源列表")
    file_paths: list[str] = Field(default_factory=list, description="数据文件路径列表")
    project_name: str = Field(..., description="项目名称")
    project_id: str = Field(..., description="项目标识")
    provider_id: Optional[str] = Field(default=None, description="指定AI Provider，不指定使用默认")
    options: ConfigGenerateOptions = Field(default_factory=ConfigGenerateOptions)


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
    iterations: Optional[int] = Field(default=None, description="当前已执行迭代轮数")
    max_iterations: Optional[int] = Field(default=None, description="最大迭代轮数")
    metrics: Optional[dict[str, Any]] = Field(default=None, description="校验指标")
    current_plan: Optional[list[dict[str, Any]]] = Field(default=None, description="当前执行计划")
    checkpoints: Optional[list[dict[str, Any]]] = Field(default=None, description="已保存的 checkpoints")
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
