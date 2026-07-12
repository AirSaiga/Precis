//! UI 渲染入口 — Synthwave 双主题：圆角细框 + 色彩分层

pub mod chat;
pub mod config;
pub mod dashboard;
pub mod provider;
pub mod sidebar;
pub mod splash;
pub mod validation;

use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, BorderType, Borders, Paragraph};
use ratatui::Frame;

use crate::app::{colors, layout, App, Phase};

/// 当前 tab 对应的主题色
fn tab_accent(tab: &crate::app::Tab) -> Color {
    match tab {
        crate::app::Tab::Dashboard => colors::cyan(),
        crate::app::Tab::Validation => colors::pink(),
        crate::app::Tab::Provider => colors::green(),
        crate::app::Tab::Config => colors::yellow(),
        crate::app::Tab::Chat => colors::purple(),
    }
}

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
    frame.render_widget(Block::default().style(Style::default().bg(colors::bg())), area);

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

    // 边框色用 tab 主题色（比 dim 更鲜明）
    let border_color = colors::blend(tab_accent(&app.current_tab), colors::bg(), 0.4);

    let sidebar_block = if use_border {
        Block::default()
            .borders(Borders::all())
            .border_type(BorderType::Rounded)
            .border_style(Style::default().fg(border_color))
            .style(Style::default().bg(colors::bg()))
    } else {
        Block::default().style(Style::default().bg(colors::bg()))
    };

    let content_block = if use_border {
        Block::default()
            .borders(Borders::all())
            .border_type(BorderType::Rounded)
            .border_style(Style::default().fg(border_color))
            .style(Style::default().bg(colors::bg()))
    } else {
        Block::default().style(Style::default().bg(colors::bg()))
    };

    // sidebar 渲染到框内部
    let sidebar_inner = sidebar_block.inner(body[0]);
    frame.render_widget(sidebar_block, body[0]);
    sidebar::render(frame, app, sidebar_inner);

    // 间距列（BG 透出）
    frame.render_widget(Block::default().style(Style::default().bg(colors::bg())), body[1]);

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

/// 标题栏：项目名 + 当前页彩色标签 + 状态
fn render_header(frame: &mut Frame, app: &App, area: Rect) {
    let project = app.project_name.as_deref().unwrap_or("Precis");
    let accent = tab_accent(&app.current_tab);

    // 项目名呼吸流光（在 FG 和 tab 主题色之间）
    let phase = (app.frame_count as f64 * 0.04).sin() * 0.5 + 0.5;
    let glow_color = colors::blend(colors::fg(), accent, phase * 0.5);

    let header = Paragraph::new(Line::from(vec![
        Span::raw(" "),
        Span::styled(project, Style::default().fg(glow_color).add_modifier(Modifier::BOLD)),
        Span::raw("  "),
        // 当前页彩色标签
        Span::styled(" ◈ ", Style::default().fg(accent)),
        Span::styled(app.current_tab.label(), Style::default().fg(accent).add_modifier(Modifier::BOLD)),
        // 右侧主题指示
        Span::raw(" "),
        Span::styled(format!("  [{}]", colors::theme_name()), Style::default().fg(colors::dim())),
    ]))
    .style(Style::default().bg(colors::surface()));
    frame.render_widget(header, area);
}

/// 状态栏：状态点 + 消息 + 快捷键
fn render_footer(frame: &mut Frame, app: &App, area: Rect) {
    let dot_color = if app.project_name.is_some() { colors::green() } else { colors::dim() };
    let accent = tab_accent(&app.current_tab);
    let footer = Paragraph::new(Line::from(vec![
        Span::raw(" "),
        Span::styled("●", Style::default().fg(dot_color)),
        Span::raw(" "),
        Span::styled(&app.message, Style::default().fg(colors::muted())),
        Span::raw("  "),
        Span::styled("Tab", Style::default().fg(accent)),
        Span::styled("切换  ", Style::default().fg(colors::dim())),
        Span::styled("F2", Style::default().fg(colors::cyan())),
        Span::styled("动效  ", Style::default().fg(colors::dim())),
        Span::styled("F3", Style::default().fg(colors::pink())),
        Span::styled("主题  ", Style::default().fg(colors::dim())),
        Span::styled("q", Style::default().fg(colors::yellow())),
        Span::styled("退出", Style::default().fg(colors::dim())),
    ]))
    .style(Style::default().bg(colors::surface()));
    frame.render_widget(footer, area);
}
