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
