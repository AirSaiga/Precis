//! HTTP 客户端：封装对 Python FastAPI 后端的调用
//!
//! 所有项目相关请求自动注入 X-Project-Config-Path header（后端依赖注入要求）。

use anyhow::{Context, Result};

use super::types::*;
use crate::i18n::pick;

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
            // 该错误会进入校验页 Failed 视图展示给用户，需 i18n
            anyhow::bail!(
                "{} ({}): {}",
                pick("校验请求失败", "Validation request failed"),
                status,
                preview
            );
        }
        let preview: String = text.chars().take(200).collect();
        serde_json::from_str(&text).context(format!(
            "{}: {}",
            pick("解析校验响应失败", "Failed to parse validation response"),
            preview
        ))
    }

    // ---- Provider 管理（无项目 header） ----

    /// 获取所有 Provider
    pub async fn list_providers(&self) -> Result<Vec<super::types::ProviderInfo>> {
        let resp = self
            .http
            .get(&format!("{}/api/latest/ai/providers", self.base_url))
            .send()
            .await?;
        let providers: Vec<super::types::ProviderInfo> = resp.json().await?;
        Ok(providers)
    }

    /// 获取当前活跃 Provider
    pub async fn get_active_provider(&self) -> Result<Option<super::types::ProviderInfo>> {
        let resp = self
            .http
            .get(&format!("{}/api/latest/ai/providers/active", self.base_url))
            .send()
            .await?;
        if !resp.status().is_success() {
            return Ok(None);
        }
        let body: super::types::ActiveProviderResponse = resp.json().await?;
        Ok(body.provider)
    }

    /// 设为活跃
    pub async fn activate_provider(&self, id: &str) -> Result<()> {
        let resp = self
            .http
            .post(&format!(
                "{}/api/latest/ai/providers/{}/activate",
                self.base_url, id
            ))
            .send()
            .await?;
        if !resp.status().is_success() {
            anyhow::bail!("激活失败: {}", resp.status());
        }
        Ok(())
    }

    /// 测试连接
    pub async fn test_provider(&self, id: &str) -> Result<super::types::TestProviderResponse> {
        let resp = self
            .http
            .post(&format!(
                "{}/api/latest/ai/providers/{}/test",
                self.base_url, id
            ))
            .send()
            .await?;
        let text = resp.text().await?;
        // 该错误会出现在 Provider 页测试结果 toast 中，需 i18n
        serde_json::from_str(&text).context(pick(
            "解析测试连接响应失败",
            "Failed to parse connection test response",
        ))
    }

    /// 创建 Provider
    pub async fn create_provider(
        &self,
        req: &super::types::CreateProviderRequest,
    ) -> Result<super::types::ProviderInfo> {
        let resp = self
            .http
            .post(&format!("{}/api/latest/ai/providers", self.base_url))
            .json(req)
            .send()
            .await?;
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            // 后端 409 = id 冲突；422 = 参数校验失败，detail 里有具体原因
            // 该错误会写入状态栏消息展示给用户，需 i18n
            let preview: String = text.chars().take(200).collect();
            anyhow::bail!(
                "{} ({}): {}",
                pick("创建失败", "Failed to create"),
                status,
                preview
            );
        }
        serde_json::from_str(&text)
            .context(pick("解析创建响应失败", "Failed to parse create response"))
    }

    // ---- 配置管理（需要项目 header） ----

    /// 获取全量配置
    pub async fn get_full_config(&self) -> Result<super::types::FullConfigResponse> {
        let mut req = self
            .http
            .get(&format!("{}/api/latest/project/config/full", self.base_url));
        if let Some(ref p) = self.project_path {
            req = req.header("X-Project-Config-Path", p);
        }
        let resp = req.send().await?;
        let text = resp.text().await?;
        serde_json::from_str(&text).context("解析配置响应失败")
    }

    // ---- AI 对话 ----

    /// 发送消息
    pub async fn send_chat(
        &self,
        message: &str,
        history: &[super::types::ChatMessage],
    ) -> Result<super::types::AiChatResponse> {
        let mut req = self
            .http
            .post(&format!("{}/api/latest/ai/chat", self.base_url));
        if let Some(ref p) = self.project_path {
            req = req.header("X-Project-Config-Path", p);
        }
        let body = super::types::AiChatRequest {
            message: message.to_string(),
            context: None,
            history: if history.is_empty() {
                None
            } else {
                Some(history.to_vec())
            },
        };
        let resp = req.json(&body).send().await?;
        let text = resp.text().await?;
        let preview: String = text.chars().take(200).collect();
        // 该错误会作为 AI 消息气泡内容展示给用户，需 i18n
        serde_json::from_str(&text).context(format!(
            "{}: {}",
            pick("解析 Chat 响应失败", "Failed to parse chat response"),
            preview
        ))
    }
}

/// 标准 URL 百分号编码（RFC 3986）。
///
/// 查询参数值必须整体编码：除 unreserved（A-Za-z0-9-_.~）外的所有字节一律
/// 转义为 %XX。此前只转义空格和反斜杠的实现会被路径中的 &、#、+、% 等字符
/// 破坏（& 截断参数、# 截断整个查询串、% 引发二次解码歧义）。
/// 按字节（而非 char）编码，多字节 UTF-8 序列同样被正确转义。
mod urlencoding {
    pub fn encode(s: &str) -> String {
        let mut out = String::with_capacity(s.len());
        for &b in s.as_bytes() {
            match b {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                    out.push(b as char);
                }
                _ => out.push_str(&format!("%{:02X}", b)),
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::urlencoding::encode;

    #[test]
    fn encodes_query_breaking_characters() {
        // & 和 # 会截断查询串；% 会造成二次解码歧义；+ 会被服务端解成空格
        assert_eq!(encode("a&b"), "a%26b");
        assert_eq!(encode("a#b"), "a%23b");
        assert_eq!(encode("100%"), "100%25");
        assert_eq!(encode("a+b"), "a%2Bb");
        assert_eq!(encode("?/=:"), "%3F%2F%3D%3A");
    }

    #[test]
    fn preserves_unreserved_and_encodes_space_and_backslash() {
        assert_eq!(encode("abcXYZ019-_.~"), "abcXYZ019-_.~");
        assert_eq!(encode("my project\\dir"), "my%20project%5Cdir");
    }

    #[test]
    fn encodes_multibyte_utf8_bytewise() {
        // "目录" = E7 9B AE E5 BD 95，按字节逐一转义（非按 char）
        assert_eq!(encode("目录"), "%E7%9B%AE%E5%BD%95");
    }

    #[test]
    fn empty_string_stays_empty() {
        assert_eq!(encode(""), "");
    }
}
