//! 应用状态管理 + 全局配色常量（Linear 风格极简高级感）

use crate::api::types::{FullValidationResponse, ProjectInfo};

/// 配色 — 深色沉浸底 + 灰度分层 + 单色强调（Linear 风格）
pub mod colors {
    use ratatui::style::Color;
    pub const BG: Color = Color::Rgb(14, 14, 22);       // #0e0e16 最深背景（沉浸感）
    pub const SURFACE: Color = Color::Rgb(22, 22, 30);  // #16161e 面板/卡片
    pub const PANEL: Color = Color::Rgb(26, 27, 38);    // #1a1b26 hover/选中
    pub const BOOST: Color = Color::Rgb(36, 40, 59);    // #24283b 高亮交互
    pub const FG: Color = Color::Rgb(192, 202, 245);    // #c0caf5 正文
    pub const MUTED: Color = Color::Rgb(122, 133, 176); // #7a85b0 次要（提亮，可读）
    pub const DIM: Color = Color::Rgb(76, 86, 106);     // #4c566a 最暗文字（提亮，不再隐形）
    pub const PRIMARY: Color = Color::Rgb(122, 162, 247); // #7aa2f7 蓝（唯一强调）
    pub const GREEN: Color = Color::Rgb(158, 206, 106); // #9ece6a
    pub const YELLOW: Color = Color::Rgb(224, 175, 104); // #e0af68
    pub const RED: Color = Color::Rgb(247, 118, 142);   // #f7768e
    pub const CYAN: Color = Color::Rgb(125, 207, 255);  // #7dcfff 流星色
}

/// 功能页面
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tab {
    Dashboard,
    Validation,
    Provider,
    Config,
    Chat,
}

impl Tab {
    pub fn label(&self) -> &'static str {
        match self {
            Tab::Dashboard => "首页",
            Tab::Validation => "校验",
            Tab::Provider => "Provider",
            Tab::Config => "配置",
            Tab::Chat => "AI 对话",
        }
    }
    pub fn from_index(i: usize) -> Option<Tab> {
        match i { 0 => Some(Tab::Dashboard), 1 => Some(Tab::Validation), 2 => Some(Tab::Provider), 3 => Some(Tab::Config), 4 => Some(Tab::Chat), _ => None }
    }
    pub fn index(&self) -> usize {
        match self { Tab::Dashboard => 0, Tab::Validation => 1, Tab::Provider => 2, Tab::Config => 3, Tab::Chat => 4 }
    }
    pub fn all() -> [Tab; 5] {
        [Tab::Dashboard, Tab::Validation, Tab::Provider, Tab::Config, Tab::Chat]
    }
}

pub enum ValidationState { Idle, Validating, Done(Box<FullValidationResponse>), Failed(String) }

/// Provider 连接测试结果
#[derive(Debug, Clone)]
pub enum TestResult {
    Ok(String),
    Fail(String),
}

/// Chat 消息
#[derive(Debug, Clone)]
pub struct ChatMsg {
    pub role: String,
    pub content: String,
}

/// 应用是否在 splash 阶段
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase { Splash, Running }

pub struct App {
    pub api: crate::api::ApiClient,
    pub current_tab: Tab,
    pub projects: Vec<ProjectInfo>,
    pub selected_project: usize,
    pub project_name: Option<String>,
    pub validation: ValidationState,
    pub message: String,
    pub should_quit: bool,
    pub frame_count: u64,
    pub fx_enabled: bool,
    pub fx: crate::fx::Fx,
    pub error_cursor: usize,
    pub opening_project: bool,
    pub phase: Phase,
    pub splash_frame: usize,
    // Provider 页状态
    pub providers: Vec<crate::api::types::ProviderInfo>,
    pub active_provider_id: Option<String>,
    pub provider_cursor: usize,
    pub provider_test_result: Option<TestResult>,
    // Config 页状态
    pub config_data: Option<crate::api::types::FullConfigResponse>,
    // Chat 页状态
    pub chat_messages: Vec<ChatMsg>,
    pub chat_input: String,
    pub chat_loading: bool,
}

impl App {
    pub fn new(base_url: &str) -> Self {
        Self {
            api: crate::api::ApiClient::new(base_url),
            current_tab: Tab::Dashboard,
            projects: Vec::new(),
            selected_project: 0,
            project_name: None,
            validation: ValidationState::Idle,
            message: String::new(),
            should_quit: false,
            frame_count: 0,
            fx_enabled: true,
            fx: crate::fx::Fx::new(),
            error_cursor: 0,
            opening_project: false,
            phase: Phase::Splash,
            splash_frame: 0,
            providers: Vec::new(),
            active_provider_id: None,
            provider_cursor: 0,
            provider_test_result: None,
            config_data: None,
            chat_messages: Vec::new(),
            chat_input: String::new(),
            chat_loading: false,
        }
    }
    pub fn quit(&mut self) { self.should_quit = true; }
    pub fn switch_tab(&mut self, tab: Tab) { self.current_tab = tab; }
    pub fn tick(&mut self) { self.frame_count = self.frame_count.wrapping_add(1); }
}
