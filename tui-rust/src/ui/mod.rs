//! UI 渲染模块

pub mod dashboard;
pub mod validation;

use ratatui::layout::{Constraint, Direction, Layout};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Paragraph, Tabs};
use ratatui::Frame;

use crate::app::{App, Tab};

/// Tokyo Night 配色
const BG: Color = Color::Rgb(22, 22, 30); // #16161e
const FG: Color = Color::Rgb(192, 202, 245); // #c0caf5
const PRIMARY: Color = Color::Rgb(122, 162, 247); // #7aa2f7
const ACCENT: Color = Color::Rgb(187, 154, 247); // #bb9af7
const GREEN: Color = Color::Rgb(158, 206, 106); // #9ece6a
const RED: Color = Color::Rgb(247, 118, 142); // #f7768e
const YELLOW: Color = Color::Rgb(224, 175, 104); // #e0af68
const MUTED: Color = Color::Rgb(86, 95, 137); // #565f89

/// 统一渲染入口
pub fn render(frame: &mut Frame, app: &mut App) {
    let area = frame.area();

    // 整体布局：顶部 tabs + 底部状态栏 + 中间内容
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3),  // tabs
            Constraint::Min(1),    // 内容区
            Constraint::Length(1), // 状态栏
        ])
        .split(area);

    // 顶部 Tabs
    let titles = vec![" Dashboard ", " Validation "];
    let tabs = Tabs::new(titles)
        .block(Block::default().borders(Borders::BOTTOM).style(Style::default().bg(BG).fg(MUTED)))
        .select(match app.current_tab {
            Tab::Dashboard => 0,
            Tab::Validation => 1,
        })
        .highlight_style(Style::default().fg(PRIMARY).add_modifier(Modifier::BOLD))
        .divider(Span::styled("│", Style::default().fg(MUTED)));
    frame.render_widget(tabs, chunks[0]);

    // 内容区（按当前 tab 渲染）
    match app.current_tab {
        Tab::Dashboard => dashboard::render(frame, app, chunks[1]),
        Tab::Validation => validation::render(frame, app, chunks[1]),
    }

    // 底部状态栏
    let status = Paragraph::new(Line::from(vec![
        Span::styled("● ", Style::default().fg(if app.project_name.is_some() { GREEN } else { YELLOW })),
        Span::styled(
            app.project_name.clone().unwrap_or_else(|| "未打开项目".to_string()),
            Style::default().fg(FG),
        ),
        Span::raw("  "),
        Span::styled(&app.message, Style::default().fg(FG)),
    ]))
    .style(Style::default().bg(BG));
    frame.render_widget(status, chunks[2]);
}

/// 获取配色常量（供子模块使用）
pub fn colors() -> (Color, Color, Color, Color, Color, Color, Color, Color) {
    (BG, FG, PRIMARY, ACCENT, GREEN, RED, YELLOW, MUTED)
}
