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

impl Clone for ApiClient {
    fn clone(&self) -> Self {
        Self {
            base_url: self.base_url.clone(),
            http: self.http.clone(),
            project_path: self.project_path.clone(),
        }
    }
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

    /// 打开项目（静态版本，不修改 self，供 spawn 异步调用）
    pub async fn open_project_static(&self, path: &str) -> Result<OpenProjectResponse> {
        let resp = self
            .post("/api/latest/projects/open")
            .json(&OpenProjectRequest {
                path: path.to_string(),
            })
            .send()
            .await?;
        let body: OpenProjectResponse = resp.json().await.context("解析打开项目响应")?;
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
            let preview: String = text.chars().take(500).collect();
            anyhow::bail!("校验请求失败 ({}): {}", status, preview);
        }
        let preview: String = text.chars().take(200).collect();
        serde_json::from_str(&text).context(format!("解析校验响应失败: {}", preview))
    }

    // ---- Provider 管理（无项目 header） ----

    /// 获取所有 Provider
    pub async fn list_providers(&self) -> Result<Vec<super::types::ProviderInfo>> {
        let resp = self.http.get(&format!("{}/api/latest/ai/providers", self.base_url)).send().await?;
        let providers: Vec<super::types::ProviderInfo> = resp.json().await?;
        Ok(providers)
    }

    /// 获取当前活跃 Provider
    pub async fn get_active_provider(&self) -> Result<Option<super::types::ProviderInfo>> {
        let resp = self.http.get(&format!("{}/api/latest/ai/providers/active", self.base_url)).send().await?;
        if !resp.status().is_success() { return Ok(None); }
        let body: super::types::ActiveProviderResponse = resp.json().await?;
        Ok(body.provider)
    }

    /// 设为活跃
    pub async fn activate_provider(&self, id: &str) -> Result<()> {
        let resp = self.http.post(&format!("{}/api/latest/ai/providers/{}/activate", self.base_url, id)).send().await?;
        if !resp.status().is_success() {
            anyhow::bail!("激活失败: {}", resp.status());
        }
        Ok(())
    }

    /// 测试连接
    pub async fn test_provider(&self, id: &str) -> Result<super::types::TestProviderResponse> {
        let resp = self.http.post(&format!("{}/api/latest/ai/providers/{}/test", self.base_url, id)).send().await?;
        let text = resp.text().await?;
        serde_json::from_str(&text).context("解析测试连接响应失败")
    }

    // ---- 配置管理（需要项目 header） ----

    /// 获取全量配置
    pub async fn get_full_config(&self) -> Result<super::types::FullConfigResponse> {
        let mut req = self.http.get(&format!("{}/api/latest/project/config/full", self.base_url));
        if let Some(ref p) = self.project_path {
            req = req.header("X-Project-Config-Path", p);
        }
        let resp = req.send().await?;
        let text = resp.text().await?;
        serde_json::from_str(&text).context("解析配置响应失败")
    }

    // ---- AI 对话 ----

    /// 发送消息
    pub async fn send_chat(&self, message: &str, history: &[super::types::ChatMessage]) -> Result<super::types::AiChatResponse> {
        let mut req = self.http.post(&format!("{}/api/latest/ai/chat", self.base_url));
        if let Some(ref p) = self.project_path {
            req = req.header("X-Project-Config-Path", p);
        }
        let body = super::types::AiChatRequest {
            message: message.to_string(),
            context: None,
            history: if history.is_empty() { None } else { Some(history.to_vec()) },
        };
        let resp = req.json(&body).send().await?;
        let text = resp.text().await?;
        let preview: String = text.chars().take(200).collect();
        serde_json::from_str(&text).context(format!("解析 Chat 响应失败: {}", preview))
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
