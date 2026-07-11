//! UI 渲染入口 — Linear 风格：无边框、大留白、背景分层

pub mod chat;
pub mod config;
pub mod dashboard;
pub mod provider;
pub mod sidebar;
pub mod splash;
pub mod validation;

use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, BorderType, Borders, Paragraph};
use ratatui::Frame;

use crate::app::{colors, layout, App, Phase};

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

    // 布局：标题栏 + 主体 + 状态栏
    let main = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(layout::HEADER_HEIGHT),
            Constraint::Min(1),
            Constraint::Length(layout::FOOTER_HEIGHT),
        ])
        .split(area);

    render_header(frame, app, main[0]);

    // 主体：侧边栏 + 间距 + 内容区
    let body = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Length(layout::SIDEBAR_WIDTH),
            Constraint::Length(layout::SIDEBAR_GAP),
            Constraint::Min(1),
        ])
        .split(main[1]);

    // 窄终端退化为无边框
    let use_border = area.width >= layout::MIN_WIDTH_NO_BORDER;

    let sidebar_block = if use_border {
        Block::default()
            .borders(Borders::all())
            .border_type(BorderType::Rounded)
            .border_style(Style::default().fg(colors::DIM))
            .style(Style::default().bg(colors::BG))
    } else {
        Block::default().style(Style::default().bg(colors::BG))
    };

    let content_block = if use_border {
        Block::default()
            .borders(Borders::all())
            .border_type(BorderType::Rounded)
            .border_style(Style::default().fg(colors::DIM))
            .style(Style::default().bg(colors::BG))
    } else {
        Block::default().style(Style::default().bg(colors::BG))
    };

    // sidebar 渲染到框内部
    let sidebar_inner = sidebar_block.inner(body[0]);
    frame.render_widget(sidebar_block, body[0]);
    sidebar::render(frame, app, sidebar_inner);

    // 间距列（BG 透出）
    frame.render_widget(Block::default().style(Style::default().bg(colors::BG)), body[1]);

    // 内容区渲染到框内部
    let content_inner = content_block.inner(body[2]);
    frame.render_widget(content_block, body[2]);
    match app.current_tab {
        crate::app::Tab::Dashboard => dashboard::render(frame, app, content_inner),
        crate::app::Tab::Validation => validation::render(frame, app, content_inner),
        crate::app::Tab::Provider => provider::render(frame, app, content_inner),
        crate::app::Tab::Config => config::render(frame, app, content_inner),
        crate::app::Tab::Chat => chat::render(frame, app, content_inner),
    }

    render_footer(frame, app, main[2]);

    // 动效：渲染到 buffer，只覆盖空白 cell
    if app.fx_enabled {
        app.fx.update(area);
        let buf = frame.buffer_mut();
        app.fx.render(buf, area);
    }
}

/// 标题栏：◤◢ logo + 项目名呼吸流光 + 当前页
fn render_header(frame: &mut Frame, app: &App, area: Rect) {
    let project = app.project_name.as_deref().unwrap_or("Precis");

    // 流光：用 sin 在 FG 和 PINK 之间柔和呼吸（周期约 4 秒）
    let phase = (app.frame_count as f64 * 0.04).sin() * 0.5 + 0.5; // 0..1
    let glow_color = colors::blend(colors::FG, colors::PINK, phase * 0.6);

    let header = Paragraph::new(Line::from(vec![
        Span::raw(" "),
        Span::styled("◤◢", Style::default().fg(colors::PINK).add_modifier(Modifier::BOLD)),
        Span::raw(" "),
        Span::styled(project, Style::default().fg(glow_color).add_modifier(Modifier::BOLD)),
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
