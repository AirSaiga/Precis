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

/// 统一渲染入口（每帧调用）
pub fn render(frame: &mut Frame, app: &mut App) {
    let area = frame.area();
    app.tick(); // 帧计数 +1（动效用）

    // 整体背景填充
    frame.render_widget(Block::default().style(Style::default().bg(colors::BG)), area);

    // 布局：顶部标题栏 + 中间（侧边栏 | 内容区）+ 底部状态栏
    let main = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(1), Constraint::Min(1), Constraint::Length(1)])
        .split(area);

    render_title_bar(frame, app, main[0]);

    // 中间区域：侧边栏 + 内容
    let body = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Length(20), Constraint::Min(1)])
        .split(main[1]);

    sidebar::render(frame, app, body[0]);

    // 内容区按当前 tab 渲染
    let content_area = Rect {
        x: body[1].x,
        y: body[1].y,
        width: body[1].width,
        height: body[1].height,
    };
    match app.current_tab {
        crate::app::Tab::Dashboard => dashboard::render(frame, app, content_area),
        crate::app::Tab::Validation => validation::render(frame, app, content_area),
        _ => render_placeholder(frame, app, content_area),
    }

    render_status_bar(frame, app, main[2]);
}

/// 顶部标题栏
fn render_title_bar(frame: &mut Frame, app: &App, area: Rect) {
    let title = Paragraph::new(Line::from(vec![
        Span::styled("◈ PRECIS ", Style::default().fg(colors::PRIMARY).add_modifier(Modifier::BOLD)),
        Span::styled("v0.1.0", Style::default().fg(colors::MUTED)),
        Span::raw("  "),
        Span::styled("·  ", Style::default().fg(colors::BORDER)),
        Span::styled(
            app.current_tab.label(),
            Style::default().fg(colors::ACCENT),
        ),
    ]))
    .style(Style::default().bg(colors::SURFACE));
    frame.render_widget(title, area);

    // 标题栏底部分隔线
    let divider = Block::default().borders(Borders::BOTTOM).border_style(Style::default().fg(colors::BORDER));
    frame.render_widget(divider, area);
}

/// 底部状态栏
fn render_status_bar(frame: &mut Frame, app: &App, area: Rect) {
    let project_indicator = if app.project_name.is_some() {
        (colors::GREEN, "●")
    } else {
        (colors::YELLOW, "○")
    };

    let status = Paragraph::new(Line::from(vec![
        Span::styled(format!("{} ", project_indicator.1), Style::default().fg(project_indicator.0)),
        Span::styled(
            app.project_name.clone().unwrap_or_else(|| "未打开项目".to_string()),
            Style::default().fg(colors::FG),
        ),
        Span::raw("  "),
        Span::styled("│  ", Style::default().fg(colors::BORDER)),
        Span::styled(&app.message, Style::default().fg(colors::MUTED)),
    ]))
    .style(Style::default().bg(colors::SURFACE));
    frame.render_widget(status, area);
}

/// 未实现的页面占位
fn render_placeholder(frame: &mut Frame, app: &App, area: Rect) {
    let p = Paragraph::new(format!(
        "『{}』 页面开发中...\n\n按 1-5 / Tab 切换页面",
        app.current_tab.label()
    ))
    .style(Style::default().fg(colors::MUTED))
    .alignment(ratatui::layout::Alignment::Center);
    frame.render_widget(p, area);
}
