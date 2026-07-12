//! 应用状态管理 + 全局配色系统（双主题：樱花粉 / 飘雪冰蓝）

use crate::api::types::{FullValidationResponse, ProjectInfo};

/// 配色 — 双主题系统，通过 thread_local 持有当前调色板
pub mod colors {
    use ratatui::style::Color;
    use std::cell::Cell;

    /// 调色板结构体 — 持有一套主题的全部色值
    pub struct Palette {
        pub bg: Color,
        pub surface: Color,
        pub panel: Color,
        pub boost: Color,
        pub fg: Color,
        pub muted: Color,
        pub dim: Color,
        pub primary: Color,   // 樱花粉 / 冰蓝
        pub secondary: Color, // 柔青 / 月白
        pub green: Color,
        pub yellow: Color,
        pub red: Color,
        pub purple: Color,
        pub name: &'static str,
    }

    /// 樱花粉主题
    const SAKURA: Palette = Palette {
        bg: Color::Rgb(15, 8, 24),
        surface: Color::Rgb(25, 16, 38),
        panel: Color::Rgb(35, 24, 52),
        boost: Color::Rgb(48, 34, 68),
        fg: Color::Rgb(224, 200, 232),
        muted: Color::Rgb(154, 138, 174),
        dim: Color::Rgb(91, 74, 110),
        primary: Color::Rgb(255, 176, 208),
        secondary: Color::Rgb(125, 211, 252),
        green: Color::Rgb(134, 239, 172),
        yellow: Color::Rgb(252, 211, 77),
        red: Color::Rgb(253, 164, 175),
        purple: Color::Rgb(192, 132, 252),
        name: "樱花粉",
    };

    /// 飘雪冰蓝主题
    const SNOW: Palette = Palette {
        bg: Color::Rgb(10, 14, 26),
        surface: Color::Rgb(15, 22, 38),
        panel: Color::Rgb(22, 32, 58),
        boost: Color::Rgb(30, 42, 64),
        fg: Color::Rgb(200, 214, 240),
        muted: Color::Rgb(122, 138, 170),
        dim: Color::Rgb(74, 90, 120),
        primary: Color::Rgb(137, 180, 250),
        secondary: Color::Rgb(212, 228, 247),
        green: Color::Rgb(163, 230, 53),
        yellow: Color::Rgb(249, 215, 28),
        red: Color::Rgb(236, 110, 110),
        purple: Color::Rgb(179, 157, 219),
        name: "飘雪",
    };

    const PALETTES: &[Palette] = &[SAKURA, SNOW];

    thread_local! {
        static CURRENT: Cell<usize> = Cell::new(0);
    }

    /// 设置当前主题索引（0=樱花, 1=飘雪）
    pub fn set_theme(idx: usize) {
        CURRENT.with(|c| c.set(idx.min(PALETTES.len() - 1)));
    }

    /// 获取当前主题索引
    pub fn theme() -> usize {
        CURRENT.with(|c| c.get())
    }

    /// 获取当前主题名称
    pub fn theme_name() -> &'static str {
        PALETTES[theme()].name
    }

    // — 颜色访问函数（替代原 const，调用点 colors::PINK → colors::pink()）—

    pub fn bg() -> Color { PALETTES[theme()].bg }
    pub fn surface() -> Color { PALETTES[theme()].surface }
    pub fn panel() -> Color { PALETTES[theme()].panel }
    pub fn boost() -> Color { PALETTES[theme()].boost }
    pub fn fg() -> Color { PALETTES[theme()].fg }
    pub fn muted() -> Color { PALETTES[theme()].muted }
    pub fn dim() -> Color { PALETTES[theme()].dim }
    pub fn pink() -> Color { PALETTES[theme()].primary }
    pub fn cyan() -> Color { PALETTES[theme()].secondary }
    pub fn green() -> Color { PALETTES[theme()].green }
    pub fn yellow() -> Color { PALETTES[theme()].yellow }
    pub fn red() -> Color { PALETTES[theme()].red }
    pub fn purple() -> Color { PALETTES[theme()].purple }

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
            Tab::Config => "概览",
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

/// 主题枚举
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Theme { Sakura, Snow }

impl Theme {
    pub fn idx(&self) -> usize {
        match self { Theme::Sakura => 0, Theme::Snow => 1 }
    }
    pub fn name(&self) -> &'static str {
        match self { Theme::Sakura => "樱花粉", Theme::Snow => "飘雪" }
    }
    pub fn toggle(&self) -> Self {
        match self { Theme::Sakura => Theme::Snow, Theme::Snow => Theme::Sakura }
    }
    pub fn from_idx(idx: usize) -> Self {
        match idx { 1 => Theme::Snow, _ => Theme::Sakura }
    }
}

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
    pub theme: Theme,
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
            theme: Theme::Sakura,
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
