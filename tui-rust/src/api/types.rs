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
    /// 后端执行是否成功（false = 执行器初始化失败或运行异常）
    #[serde(default)]
    pub success: bool,
    pub summary: ValidationSummary,
    #[serde(default)]
    pub errors: Vec<ValidationErrorItem>,
    /// 详细统计信息（含 pass_rate 等真实通过率数据）
    #[serde(default)]
    pub statistics: Option<ValidationStatistics>,
    /// 后端执行失败时的错误信息（success=false 时）
    #[serde(default)]
    pub error: Option<String>,
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
    /// C6: 校验是否因遇错即停(error_handling=stop)提前终止
    #[serde(default)]
    pub interrupted: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ValidationErrorItem {
    #[serde(default)]
    pub stage: String,
    #[serde(default)]
    pub error_type: String,
    #[serde(default)]
    pub message: String,
    #[serde(default, deserialize_with = "deserialize_null_to_default")]
    pub table: String,
    #[serde(default, deserialize_with = "deserialize_null_to_default")]
    pub column: String,
    #[serde(rename = "row_index", default)]
    pub row_index: Option<i64>,
    #[serde(default, deserialize_with = "deserialize_null_to_default")]
    pub source_path: String,
}

/// 把 JSON null 反序列化为 String 默认值（空字符串）
fn deserialize_null_to_default<'de, D, T>(deserializer: D) -> Result<T, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Default + serde::Deserialize<'de>,
{
    let opt: Option<T> = Option::deserialize(deserializer)?;
    Ok(opt.unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 回归：后端 ProviderResponse 的 wire 字段是 "type"（pydantic Field(alias="type")），
    /// 曾按 "provider" 解析导致整个列表反序列化失败、Provider 页永远显示空
    #[test]
    fn test_provider_info_deserializes_wire_format() {
        let json = r#"[{"id":"deepseek","name":"DeepSeek","type":"openai","deployment":"remote","base_url":"https://api.deepseek.com","model":"deepseek-v4-flash","context_window":null,"health":{},"is_configured":true}]"#;
        let list: Vec<ProviderInfo> = serde_json::from_str(json).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "deepseek");
        assert_eq!(list[0].provider_type, "openai");
        assert_eq!(list[0].model, "deepseek-v4-flash");
    }
}

/// 校验统计信息（对齐后端 ValidationStatistics 模型）
#[derive(Debug, Clone, Deserialize)]
pub struct ValidationStatistics {
    #[serde(default)]
    pub total_checks: i64,
    #[serde(default)]
    pub passed_count: i64,
    #[serde(default)]
    pub failed_count: i64,
    /// 通过率（百分比，0-100）
    #[serde(default)]
    pub pass_rate: f64,
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
    // 后端 ProviderResponse 字段名为 provider，但 wire alias 是 "type"（Field(alias="type")）
    #[serde(rename = "type")]
    pub provider_type: String,
    pub base_url: String,
    pub model: String,
    #[serde(default)]
    pub context_window: Option<u32>,
    #[serde(default)]
    pub health: Option<serde_json::Value>,
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
    pub health: Option<serde_json::Value>,
    #[serde(default)]
    pub available_models: Vec<String>,
}

/// 创建 Provider 请求：POST /api/latest/ai/providers
#[derive(Debug, Serialize)]
pub struct CreateProviderRequest {
    pub name: String,
    #[serde(rename = "type")]
    pub provider_type: String,
    pub base_url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
    pub model: String,
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
