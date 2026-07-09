//! 应用状态管理

use crate::api::types::{FullValidationResponse, ProjectInfo};

/// 当前激活的功能页
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tab {
    Dashboard,
    Validation,
}

impl Tab {
    pub fn title(&self) -> &'static str {
        match self {
            Tab::Dashboard => "Dashboard",
            Tab::Validation => "Validation",
        }
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
    /// 扫描到的项目列表
    pub projects: Vec<ProjectInfo>,
    /// 列表选中索引
    pub selected_project: usize,
    /// 当前打开的项目名
    pub project_name: Option<String>,
    /// 校验状态
    pub validation: ValidationState,
    /// 底部状态栏消息
    pub message: String,
    /// 是否应该退出
    pub should_quit: bool,
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
            message: "Precis TUI (Rust) — 按 q 退出 | Tab 切换页".to_string(),
            should_quit: false,
        }
    }

    pub fn quit(&mut self) {
        self.should_quit = true;
    }

    pub fn next_tab(&mut self) {
        self.current_tab = match self.current_tab {
            Tab::Dashboard => Tab::Validation,
            Tab::Validation => Tab::Dashboard,
        };
    }
}
