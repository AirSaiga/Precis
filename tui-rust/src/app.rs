//! 应用状态管理 + 全局配色常量（Synthwave 樱花粉风格）

use crate::api::types::{FullValidationResponse, ProjectInfo};

/// 配色 — Synthwave 樱花粉：深紫黑底 + 樱花粉主强调 + 柔青辅强调
pub mod colors {
    use ratatui::style::Color;

    /// 颜色混合（t=0 返回 a，t=1 返回 b）— 集中定义，消除 ui/ 重复
    pub fn blend(a: Color, b: Color, t: f64) -> Color {
        let t = t.clamp(0.0, 1.0);
        match (a, b) {
            (Color::Rgb(r1, g1, b1), Color::Rgb(r2, g2, b2)) => Color::Rgb(
                (r1 as f64 + (r2 as f64 - r1 as f64) * t) as u8,
                (g1 as f64 + (g2 as f64 - g1 as f64) * t) as u8,
                (b1 as f64 + (b2 as f64 - b1 as f64) * t) as u8,
            ),
            (_, c) => c,
        }
    }

    /// 按亮度缩放颜色（用于粒子亮度变化）
    pub fn scale(base: Color, brightness: f64) -> Color {
        let b = brightness.clamp(0.0, 1.0);
        match base {
            Color::Rgb(r, g, bl) => Color::Rgb(
                (r as f64 * b) as u8,
                (g as f64 * b) as u8,
                (bl as f64 * b) as u8,
            ),
            other => other,
        }
    }

    pub const BG: Color = Color::Rgb(15, 8, 24);        // #0f0818 最深背景(深紫黑)
    pub const SURFACE: Color = Color::Rgb(25, 16, 38);  // #191026 面板/卡片
    pub const PANEL: Color = Color::Rgb(35, 24, 52);    // #231834 hover/选中
    pub const BOOST: Color = Color::Rgb(48, 34, 68);    // #302244 高亮交互
    pub const FG: Color = Color::Rgb(224, 200, 232);    // #e0c8e8 正文(淡紫白)
    pub const MUTED: Color = Color::Rgb(154, 138, 174); // #9a8aae 次要文字
    pub const DIM: Color = Color::Rgb(91, 74, 110);     // #5b4a6e 最暗文字
    pub const PINK: Color = Color::Rgb(255, 176, 208);  // #ffb0d0 樱花粉(主强调)
    pub const CYAN: Color = Color::Rgb(125, 211, 252);  // #7dd3fc 柔青(辅强调)
    pub const GREEN: Color = Color::Rgb(134, 239, 172); // #86efac 成功/通过
    pub const YELLOW: Color = Color::Rgb(252, 211, 77); // #fcd34d 警告/格式错误
    pub const RED: Color = Color::Rgb(253, 164, 175);   // #fda4af 错误/失败(柔红)
    pub const PURPLE: Color = Color::Rgb(192, 132, 252);// #c084fc 紫色(splash 第三色)
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
    /// Chat 页是否聚焦输入框（聚焦时屏蔽全局快捷键，允许输入 q/1-5/Tab/F2 等字符）
    pub chat_focused: bool,
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
            chat_focused: false,
        }
    }
    pub fn quit(&mut self) { self.should_quit = true; }
    pub fn switch_tab(&mut self, tab: Tab) { self.current_tab = tab; }
    pub fn tick(&mut self) { self.frame_count = self.frame_count.wrapping_add(1); }
}

/// 布局尺寸常量 — 集中管理，避免魔法数字散落各 ui/ 文件
pub mod layout {
    // 全局框架
    pub const HEADER_HEIGHT: u16 = 1;
    pub const FOOTER_HEIGHT: u16 = 1;
    pub const SIDEBAR_WIDTH: u16 = 18;
    pub const SIDEBAR_GAP: u16 = 1;
    pub const MIN_WIDTH_NO_BORDER: u16 = 60;

    // 各界面内部
    pub const DASHBOARD_HEADER: u16 = 8;
    pub const VALIDATION_HINT: u16 = 2;
    pub const VALIDATION_SUMMARY: u16 = 6;
    pub const PROVIDER_HINT: u16 = 2;
    pub const PROVIDER_FOOTER: u16 = 3;
    pub const CONFIG_HINT: u16 = 2;
    pub const CHAT_INPUT: u16 = 3;

    // 进度条
    pub const PROGRESS_BAR_TOTAL: usize = 10;
}
