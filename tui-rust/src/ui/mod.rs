//! UI 渲染入口 — Linear 风格：无边框、大留白、背景分层

pub mod chat;
pub mod config;
pub mod dashboard;
pub mod provider;
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

    // 主体：侧边栏(18) + 分隔(1) + 内容区
    let body = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Length(18), Constraint::Length(1), Constraint::Min(1)])
        .split(main[1]);

    sidebar::render(frame, app, body[0]);

    // 极淡分隔带（1 列 SURFACE 色，代替边框线）
    frame.render_widget(
        Block::default().style(Style::default().bg(colors::SURFACE)),
        body[1],
    );

    // 内容区按 tab 渲染
    match app.current_tab {
        crate::app::Tab::Dashboard => dashboard::render(frame, app, body[2]),
        crate::app::Tab::Validation => validation::render(frame, app, body[2]),
        crate::app::Tab::Provider => provider::render(frame, app, body[2]),
        crate::app::Tab::Config => config::render(frame, app, body[2]),
        crate::app::Tab::Chat => chat::render(frame, app, body[2]),
    }

    render_footer(frame, app, main[2]);

    // 动效：渲染到 buffer，只覆盖空白 cell
    if app.fx_enabled {
        app.fx.update(area);
        let buf = frame.buffer_mut();
        app.fx.render(buf, area);
    }
}

/// 标题栏：项目名带间歇流光呼吸 + 当前页（无边框，SURFACE 底色）
fn render_header(frame: &mut Frame, app: &App, area: Rect) {
    let project = app.project_name.as_deref().unwrap_or("Precis");

    // 流光：用 sin 在 FG 和 PRIMARY 之间柔和呼吸（周期约 4 秒）
    let phase = (app.frame_count as f64 * 0.04).sin() * 0.5 + 0.5; // 0..1
    let glow_color = blend(colors::FG, colors::PRIMARY, phase * 0.6); // 不全亮，60% 强度

    let header = Paragraph::new(Line::from(vec![
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

/// 颜色混合
fn blend(a: ratatui::style::Color, b: ratatui::style::Color, t: f64) -> ratatui::style::Color {
    use ratatui::style::Color;
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
