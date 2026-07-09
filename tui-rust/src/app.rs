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
    /// 侧边栏显示名
    pub fn label(&self) -> &'static str {
        match self {
            Tab::Dashboard => "Dashboard",
            Tab::Validation => "校验",
            Tab::Provider => "Provider",
            Tab::Config => "配置",
            Tab::Chat => "AI 对话",
        }
    }

    /// 侧边栏图标（Unicode，不用 emoji）
    pub fn icon(&self) -> &'static str {
        match self {
            Tab::Dashboard => "◈",
            Tab::Validation => "▸",
            Tab::Provider => "⚙",
            Tab::Config => "▷",
            Tab::Chat => "✦",
        }
    }

    /// 数字快捷键（1-5）
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

    /// 全部 tab（侧边栏顺序）
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

/// 应用全局状态（immediate-mode：每帧直接读写，无 widget 树）
pub struct App {
    pub api: crate::api::ApiClient,
    pub current_tab: Tab,
    /// 扫描到的项目列表
    pub projects: Vec<ProjectInfo>,
    /// 项目列表选中索引
    pub selected_project: usize,
    /// 当前打开的项目名
    pub project_name: Option<String>,
    /// 校验状态
    pub validation: ValidationState,
    /// 底部状态栏消息
    pub message: String,
    /// 是否应该退出
    pub should_quit: bool,
    /// 用于动效的帧计数（每帧 +1）
    pub frame_count: u64,
    /// 动效开关
    pub fx_enabled: bool,
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
            message: "Precis TUI (Rust) · q 退出 · Tab/数字键切换页面".to_string(),
            should_quit: false,
            frame_count: 0,
            fx_enabled: true,
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
