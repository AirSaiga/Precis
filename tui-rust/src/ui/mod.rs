//! UI 渲染入口 — Linear 风格：无边框、大留白、背景分层

pub mod dashboard;
pub mod sidebar;
pub mod splash;
pub mod validation;

use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Modifier, Style, Stylize};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Paragraph};
use ratatui::Frame;

use crate::app::{colors, App, Phase};

pub fn render(frame: &mut Frame, app: &mut App) {
    let area = frame.area();
    app.tick();

    // Splash 阶段
    if app.phase == Phase::Splash {
        splash::render(frame, app.splash_frame, area);
        app.splash_frame += 1;
        if app.splash_frame >= splash::SPLASH_FRAMES {
            app.phase = Phase::Running;
        }
        return;
    }

    // 主界面背景
    frame.render_widget(Block::default().style(Style::default().bg(colors::BG)), area);

    // 布局：标题栏(1) + 主体(min) + 状态栏(1)
    let main = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(1), Constraint::Min(1), Constraint::Length(1)])
        .split(area);

    render_header(frame, app, main[0]);

    // 主体：侧边栏(18) + 内容区
    let body = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Length(18), Constraint::Min(1)])
        .split(main[1]);

    sidebar::render(frame, app, body[0]);

    // 内容区按 tab 渲染
    match app.current_tab {
        crate::app::Tab::Dashboard => dashboard::render(frame, app, body[1]),
        crate::app::Tab::Validation => validation::render(frame, app, body[1]),
        _ => render_placeholder(frame, app, body[1]),
    }

    render_footer(frame, app, main[2]);

    // 动效：渲染到 buffer，只覆盖空白 cell
    if app.fx_enabled {
        app.fx.update(area);
        let buf = frame.buffer_mut();
        app.fx.render(buf, area);
    }
}

/// 标题栏：极简，只有项目名 + 当前页（无边框，SURFACE 底色）
fn render_header(frame: &mut Frame, app: &App, area: Rect) {
    let project = app.project_name.as_deref().unwrap_or("Precis");
    let header = Paragraph::new(Line::from(vec![
        Span::raw(" "),
        Span::styled(project, Style::default().fg(colors::FG).add_modifier(Modifier::BOLD)),
        Span::styled(
            format!("  /  {}", app.current_tab.label()),
            Style::default().fg(colors::MUTED),
        ),
    ]))
    .style(Style::default().bg(colors::SURFACE));
    frame.render_widget(header, area);
}

/// 状态栏：极简（SURFACE 底色）
fn render_footer(frame: &mut Frame, app: &App, area: Rect) {
    let dot = if app.project_name.is_some() { colors::GREEN } else { colors::DIM };
    let footer = Paragraph::new(Line::from(vec![
        Span::raw(" "),
        Span::styled("·", Style::default().fg(dot)),
        Span::raw(" "),
        Span::styled(&app.message, Style::default().fg(colors::MUTED)),
    ]))
    .style(Style::default().bg(colors::SURFACE));
    frame.render_widget(footer, area);
}

fn render_placeholder(frame: &mut Frame, app: &App, area: Rect) {
    let p = Paragraph::new(format!(
        "\n\n\n  {} 页面开发中\n\n  按 1-5 / Tab 切换",
        app.current_tab.label()
    ))
    .style(Style::default().fg(colors::DIM));
    frame.render_widget(p, area);
}
