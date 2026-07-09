//! 应用状态管理 + 全局配色常量

use crate::api::types::{FullValidationResponse, ProjectInfo};

/// Tokyo Night 配色常量（集中定义，所有 UI 模块共享）
pub mod colors {
    use ratatui::style::Color;
    pub const BG: Color = Color::Rgb(22, 22, 30); // #16161e 最深背景
    pub const SURFACE: Color = Color::Rgb(26, 27, 38); // #1a1b26 面板背景
    pub const PANEL: Color = Color::Rgb(36, 40, 59); // #24283b 交互元素
    pub const BOOST: Color = Color::Rgb(65, 72, 104); // #414868 高亮
    pub const BORDER: Color = Color::Rgb(45, 53, 72); // #2d3548 边框
    pub const FG: Color = Color::Rgb(192, 202, 245); // #c0caf5 正文
    pub const MUTED: Color = Color::Rgb(86, 95, 137); // #565f89 次要文字
    pub const PRIMARY: Color = Color::Rgb(122, 162, 247); // #7aa2f7 蓝（主强调）
    pub const ACCENT: Color = Color::Rgb(187, 154, 247); // #bb9af7 紫
    pub const GREEN: Color = Color::Rgb(158, 206, 106); // #9ece6a
    pub const YELLOW: Color = Color::Rgb(224, 175, 104); // #e0af68
    pub const RED: Color = Color::Rgb(247, 118, 142); // #f7768e
    pub const CYAN: Color = Color::Rgb(125, 207, 255); // #7dcfff
}

/// 功能页面枚举
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
            Tab::Dashboard => "Dashboard",
            Tab::Validation => "Validation",
            Tab::Provider => "Provider",
            Tab::Config => "Config",
            Tab::Chat => "AI Chat",
        }
    }

    pub fn icon(&self) -> &'static str {
        match self {
            Tab::Dashboard => crate::icons::tab::DASHBOARD,
            Tab::Validation => crate::icons::tab::VALIDATION,
            Tab::Provider => crate::icons::tab::PROVIDER,
            Tab::Config => crate::icons::tab::CONFIG,
            Tab::Chat => crate::icons::tab::CHAT,
        }
    }

    pub fn from_index(i: usize) -> Option<Tab> {
        match i {
            0 => Some(Tab::Dashboard),
            1 => Some(Tab::Validation),
            2 => Some(Tab::Provider),
            3 => Some(Tab::Config),
            4 => Some(Tab::Chat),
            _ => None,
        }
    }

    pub fn index(&self) -> usize {
        match self {
            Tab::Dashboard => 0,
            Tab::Validation => 1,
            Tab::Provider => 2,
            Tab::Config => 3,
            Tab::Chat => 4,
        }
    }

    pub fn all() -> [Tab; 5] {
        [Tab::Dashboard, Tab::Validation, Tab::Provider, Tab::Config, Tab::Chat]
    }
}

/// 校验状态
pub enum ValidationState {
    Idle,
    Validating,
    Done(Box<FullValidationResponse>),
    Failed(String),
}

/// 应用全局状态
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
    /// 错误表格滚动索引
    pub error_cursor: usize,
    /// 是否正在打开项目（异步标记）
    pub opening_project: bool,
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
            message: "q 退出  Tab/1-5 切换页面".to_string(),
            should_quit: false,
            frame_count: 0,
            fx_enabled: true,
            fx: crate::fx::Fx::new(),
            error_cursor: 0,
            opening_project: false,
        }
    }

    pub fn quit(&mut self) {
        self.should_quit = true;
    }

    pub fn switch_tab(&mut self, tab: Tab) {
        self.current_tab = tab;
    }

    pub fn tick(&mut self) {
        self.frame_count = self.frame_count.wrapping_add(1);
    }
}
