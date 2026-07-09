//! HTTP 客户端：封装对 Python FastAPI 后端的调用
//!
//! 所有项目相关请求自动注入 X-Project-Config-Path header（后端依赖注入要求）。

use anyhow::{Context, Result};

use super::types::*;

/// 后端 API 客户端
pub struct ApiClient {
    base_url: String,
    http: reqwest::Client,
    /// 当前打开项目的配置路径（用于 X-Project-Config-Path header）
    project_path: Option<String>,
}

impl ApiClient {
    /// 创建客户端，base_url 如 "http://127.0.0.1:18000"
    pub fn new(base_url: &str) -> Self {
        Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(120)) // 校验可能耗时
                .build()
                .expect("reqwest client build"),
            project_path: None,
        }
    }

    /// 设置当前项目路径（后续请求自动带 header）
    pub fn set_project(&mut self, path: &str) {
        self.project_path = Some(path.to_string());
    }

    pub fn project_path(&self) -> Option<&str> {
        self.project_path.as_deref()
    }

    /// 构建带项目 header 的 POST 请求
    fn post(&self, path: &str) -> reqwest::RequestBuilder {
        let url = format!("{}{}", self.base_url, path);
        let mut req = self.http.post(&url);
        if let Some(ref p) = self.project_path {
            req = req.header("X-Project-Config-Path", p);
        }
        req
    }

    /// 构建带项目 header 的 GET 请求
    fn get(&self, path: &str) -> reqwest::RequestBuilder {
        let url = format!("{}{}", self.base_url, path);
        let mut req = self.http.get(&url);
        if let Some(ref p) = self.project_path {
            req = req.header("X-Project-Config-Path", p);
        }
        req
    }

    /// 健康检查：GET /health
    pub async fn health(&self) -> Result<bool> {
        let resp = self.get("/health").send().await?;
        let body: HealthResponse = resp.json().await.context("解析健康检查响应")?;
        Ok(body.status == "ok")
    }

    /// 扫描工作目录下的项目：GET /api/latest/projects/scan?work_dir=xxx
    pub async fn scan_projects(&self, work_dir: &str) -> Result<Vec<ProjectInfo>> {
        let resp = self
            .get(&format!(
                "/api/latest/projects/scan?work_dir={}",
                urlencoding::encode(work_dir)
            ))
            .send()
            .await?;
        let body: ScanResponse = resp.json().await.context("解析扫描响应")?;
        Ok(body.projects)
    }

    /// 打开项目：POST /api/latest/projects/open
    pub async fn open_project(&mut self, path: &str) -> Result<OpenProjectResponse> {
        let resp = self
            .post("/api/latest/projects/open")
            .json(&OpenProjectRequest {
                path: path.to_string(),
            })
            .send()
            .await?;
        let body: OpenProjectResponse = resp.json().await.context("解析打开项目响应")?;
        if body.success {
            self.set_project(path);
        }
        Ok(body)
    }

    /// 执行全量校验：POST /api/latest/project/validate/full
    pub async fn validate_full(&self) -> Result<FullValidationResponse> {
        let resp = self
            .post("/api/latest/project/validate/full")
            .json(&FullValidationRequest {
                target: None,
                options: None,
            })
            .send()
            .await?;
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            anyhow::bail!("校验请求失败 ({}): {}", status, &text[..text.len().min(500)]);
        }
        serde_json::from_str(&text).context(format!("解析校验响应失败: {}", &text[..text.len().min(200)]))
    }
}

/// 简单的 URL 编码（避免引入额外 crate）
mod urlencoding {
    pub fn encode(s: &str) -> String {
        s.chars()
            .map(|c| match c {
                ' ' => "%20".to_string(),
                '\\' => "%5C".to_string(),
                _ => c.to_string(),
            })
            .collect()
    }
}
