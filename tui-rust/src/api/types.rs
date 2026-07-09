//! API 请求/响应类型定义（对齐 Python FastAPI 后端）
//!
//! 参考后端路由：
//! - POST /api/latest/projects/scan — 扫描项目
//! - POST /api/latest/projects/open — 打开项目
//! - POST /api/latest/project/validate/full — 全量校验

use serde::{Deserialize, Serialize};

/// 扫描项目响应：GET /api/latest/projects/scan?work_dir=xxx
#[derive(Debug, Clone, Deserialize)]
pub struct ScanResponse {
    pub work_dir: String,
    pub projects: Vec<ProjectInfo>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ProjectInfo {
    pub name: String,
    pub path: String,
    pub schema_count: Option<u32>,
    pub constraint_count: Option<u32>,
    pub last_modified: Option<String>,
}

/// 打开项目请求：POST /api/latest/projects/open
#[derive(Debug, Serialize)]
pub struct OpenProjectRequest {
    pub path: String,
}

/// 打开项目响应
#[derive(Debug, Clone, Deserialize)]
pub struct OpenProjectResponse {
    pub success: bool,
    pub name: Option<String>,
    pub path: Option<String>,
}

/// 全量校验请求：POST /api/latest/project/validate/full
#[derive(Debug, Serialize)]
pub struct FullValidationRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<ValidationTarget>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub options: Option<ValidationOptions>,
}

#[derive(Debug, Serialize)]
pub struct ValidationTarget {
    #[serde(rename = "type")]
    pub target_type: String, // "single_file" | "single_table"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub table_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ValidationOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_directory: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allow_unsafe_eval: Option<bool>,
}

/// 全量校验响应
#[derive(Debug, Clone, Deserialize)]
pub struct FullValidationResponse {
    pub summary: ValidationSummary,
    #[serde(default)]
    pub errors: Vec<ValidationErrorItem>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ValidationSummary {
    pub files_total: u32,
    pub files_loaded: u32,
    pub tables_loaded: u32,
    pub loading_error_count: u32,
    pub format_error_count: u32,
    pub constraint_error_count: u32,
    pub total_error_count: u32,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ValidationErrorItem {
    #[serde(default)]
    pub stage: String,
    #[serde(default)]
    pub error_type: String,
    #[serde(default)]
    pub message: String,
    #[serde(default)]
    pub table: String,
    #[serde(default)]
    pub column: String,
    #[serde(rename = "row_index", default)]
    pub row_index: Option<i64>,
    #[serde(default)]
    pub source_path: String,
}

/// 健康检查响应：GET /health
#[derive(Debug, Deserialize)]
pub struct HealthResponse {
    pub status: String,
}

// ============================================================================
// Provider 管理（不需要 X-Project-Config-Path）
// ============================================================================

/// Provider 列表项：GET /api/latest/ai/providers
#[derive(Debug, Clone, Deserialize)]
pub struct ProviderInfo {
    pub id: String,
    pub name: String,
    #[serde(rename = "provider")]
    pub provider_type: String,
    pub base_url: String,
    pub model: String,
    #[serde(default)]
    pub context_window: Option<u32>,
    #[serde(default)]
    pub health: Option<String>,
    #[serde(default)]
    pub is_configured: bool,
}

/// 当前活跃 Provider：GET /api/latest/ai/providers/active
#[derive(Debug, Clone, Deserialize)]
pub struct ActiveProviderResponse {
    #[serde(flatten)]
    pub provider: Option<ProviderInfo>,
}

/// 预设列表：GET /api/latest/ai/providers/presets
#[derive(Debug, Clone, Deserialize)]
pub struct ProviderPreset {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub preset_type: String,
    pub base_url: String,
    pub default_model: String,
    #[serde(default)]
    pub models: Vec<String>,
}

/// 测试连接：POST /api/latest/ai/providers/{id}/test
#[derive(Debug, Deserialize)]
pub struct TestProviderResponse {
    pub provider_id: String,
    #[serde(default)]
    pub health: Option<String>,
    #[serde(default)]
    pub available_models: Vec<String>,
}

// ============================================================================
// 配置管理（需要 X-Project-Config-Path）
// ============================================================================

/// 全量配置：GET /api/latest/project/config/full
#[derive(Debug, Clone, Deserialize)]
pub struct FullConfigResponse {
    #[serde(default)]
    pub manifest: serde_json::Value,
    #[serde(default)]
    pub schemas: serde_json::Value,
    #[serde(default)]
    pub constraints: serde_json::Value,
    #[serde(default)]
    pub coverage: Option<serde_json::Value>,
}

// ============================================================================
// AI 对话
// ============================================================================

/// Chat 请求：POST /api/latest/ai/chat
#[derive(Debug, Serialize)]
pub struct AiChatRequest {
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub history: Option<Vec<ChatMessage>>,
}

/// Chat 响应
#[derive(Debug, Clone, Deserialize)]
pub struct AiChatResponse {
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub reply: String,
    #[serde(default)]
    pub actions: Vec<serde_json::Value>,
    #[serde(default)]
    pub error: Option<String>,
}

/// 对话消息（历史记录用）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}
