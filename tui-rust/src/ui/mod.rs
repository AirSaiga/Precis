//! UI 渲染模块 — immediate-mode，每帧直接画

pub mod dashboard;
pub mod sidebar;
pub mod validation;

use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Modifier, Style, Stylize};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Paragraph};
use ratatui::Frame;

use crate::app::{colors, App};
use crate::icons;

/// 统一渲染入口（每帧调用）
pub fn render(frame: &mut Frame, app: &mut App) {
    let area = frame.area();
    app.tick();

    // 整体背景
    frame.render_widget(Block::default().style(Style::default().bg(colors::BG)), area);

    // 布局：标题栏(1) + 内容区(min) + 状态栏(1)
    let main = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(1), Constraint::Min(1), Constraint::Length(1)])
        .split(area);

    render_title_bar(frame, app, main[0]);

    // 内容区：侧边栏 + 主内容
    let body = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Length(22), Constraint::Min(1)])
        .split(main[1]);

    sidebar::render(frame, app, body[0]);

    match app.current_tab {
        crate::app::Tab::Dashboard => dashboard::render(frame, app, body[1]),
        crate::app::Tab::Validation => validation::render(frame, app, body[1]),
        _ => render_placeholder(frame, app, body[1]),
    }

    render_status_bar(frame, app, main[2]);

    // 动效层：渲染到 buffer，只覆盖空白 cell（内容之后画）
    if app.fx_enabled {
        app.fx.update(area);
        let buf = frame.buffer_mut();
        app.fx.render(buf, area);
    }
}

/// 顶部标题栏（单行，SURFACE 背景，底部分隔线）
fn render_title_bar(frame: &mut Frame, app: &App, area: Rect) {
    let title = Paragraph::new(Line::from(vec![
        Span::raw(" "),
        Span::styled(
            format!("{} ", icons::LOGO),
            Style::default().fg(colors::PRIMARY),
        ),
        Span::styled("PRECIS", Style::default().fg(colors::FG).add_modifier(Modifier::BOLD)),
        Span::styled(" v0.1.0  ", Style::default().fg(colors::MUTED)),
        Span::styled(
            icons::divider(area.width as usize - 4),
            Style::default().fg(colors::BORDER),
        ),
    ]))
    .style(Style::default().bg(colors::SURFACE));
    frame.render_widget(title, area);

    // 底部分隔线
    let line = Block::default().borders(Borders::BOTTOM).border_style(Style::default().fg(colors::BORDER));
    frame.render_widget(line, area);
}

/// 底部状态栏（单行，SURFACE 背景）
fn render_status_bar(frame: &mut Frame, app: &App, area: Rect) {
    let project_icon = if app.project_name.is_some() {
        icons::status::CONNECTED
    } else {
        icons::status::DISCONNECTED
    };
    let project_color = if app.project_name.is_some() {
        colors::GREEN
    } else {
        colors::MUTED
    };

    let status = Paragraph::new(Line::from(vec![
        Span::raw(" "),
        Span::styled(project_icon, Style::default().fg(project_color)),
        Span::raw(" "),
        Span::styled(
            app.project_name.clone().unwrap_or_else(|| "未打开".to_string()),
            Style::default().fg(colors::FG),
        ),
        Span::styled("  ", Style::default()),
        Span::styled("│", Style::default().fg(colors::BORDER)),
        Span::styled("  ", Style::default()),
        Span::styled(app.current_tab.label(), Style::default().fg(colors::ACCENT)),
        Span::styled("  ", Style::default()),
        Span::styled("│", Style::default().fg(colors::BORDER)),
        Span::styled("  ", Style::default()),
        Span::styled(&app.message, Style::default().fg(colors::MUTED)),
    ]))
    .style(Style::default().bg(colors::SURFACE));
    frame.render_widget(status, area);
}

/// 未实现页面占位
fn render_placeholder(frame: &mut Frame, app: &App, area: Rect) {
    let p = Paragraph::new(format!(
        "\n\n  {} 页面开发中\n\n  按 1-5 / Tab 切换页面",
        app.current_tab.label()
    ))
    .style(Style::default().fg(colors::MUTED));
    frame.render_widget(p, area);
}
