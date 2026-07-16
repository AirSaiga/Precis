//! 侧边栏 — 彩色图标 + 选中高亮条（Synthwave 风格）

use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;
use ratatui::Frame;
use ratatui::style::Color;

use crate::app::{colors, App, Tab};
use crate::icons;

/// 每个 tab 的图标颜色（即使未选中也有色彩辨识度）
fn tab_icon_color(tab: &Tab) -> Color {
    match tab {
        Tab::Dashboard => colors::cyan(),
        Tab::Validation => colors::pink(),
        Tab::Provider => colors::green(),
        Tab::Config => colors::yellow(),
        Tab::Chat => colors::purple(),
    }
}

pub fn render(frame: &mut Frame, app: &App, area: Rect) {
    let mut lines: Vec<Line> = Vec::new();

    // 顶部 logo 区
    lines.push(Line::from(vec![
        Span::raw(" "),
        Span::styled("◤◢", Style::default().fg(colors::pink()).add_modifier(Modifier::BOLD)),
        Span::raw(" "),
        Span::styled("Precis", Style::default().fg(colors::fg()).add_modifier(Modifier::BOLD)),
    ]));
    // 分隔线
    lines.push(Line::from(Span::styled(
        " ───────────────",
        Style::default().fg(colors::dim()),
    )));
    lines.push(Line::from(""));

    // 导航项
    for (i, tab) in Tab::all().iter().enumerate() {
        let active = *tab == app.current_tab;
        let icon = match *tab {
            Tab::Dashboard => icons::tab::DASHBOARD,
            Tab::Validation => icons::tab::VALIDATION,
            Tab::Provider => icons::tab::PROVIDER,
            Tab::Config => icons::tab::CONFIG,
            Tab::Chat => icons::tab::CHAT,
        };
        let icon_color = tab_icon_color(tab);

        if active {
            // 选中态：█ 左侧色条 + 图标高亮 + 文字加粗 + PANEL 背景
            lines.push(Line::from(vec![
                Span::styled("█", Style::default().fg(icon_color)),
                Span::styled(format!(" {} ", i + 1), Style::default().fg(icon_color).add_modifier(Modifier::BOLD)),
                Span::styled(format!("{} ", icon), Style::default().fg(icon_color).add_modifier(Modifier::BOLD)),
                Span::styled(tab.label(), Style::default().fg(colors::fg()).add_modifier(Modifier::BOLD)),
            ]).style(Style::default().bg(colors::panel())));
        } else {
            // 未选中：图标各自色彩（暗化），文字 muted
            lines.push(Line::from(vec![
                Span::raw(" "),
                Span::styled(format!(" {} ", i + 1), Style::default().fg(colors::dim())),
                Span::styled(format!("{} ", icon), Style::default().fg(colors::blend(icon_color, colors::bg(), 0.5))),
                Span::styled(tab.label(), Style::default().fg(colors::muted())),
            ]).style(Style::default().bg(colors::bg())));
        }
    }

    // 底部分隔
    lines.push(Line::from(""));
    lines.push(Line::from(Span::styled(
        " ───────────────",
        Style::default().fg(colors::dim()),
    )));

    // 底部留白
    let pad = area.height.saturating_sub(lines.len() as u16 + 5);
    for _ in 0..pad {
        lines.push(Line::from(""));
    }

    // 快捷键提示（带色标）
    lines.push(Line::from(vec![
        Span::styled(" F2 ", Style::default().fg(colors::cyan())),
        Span::styled("动效", Style::default().fg(colors::muted())),
        Span::raw("  "),
        Span::styled("F3 ", Style::default().fg(colors::pink())),
        Span::styled("主题", Style::default().fg(colors::muted())),
    ]));
    lines.push(Line::from(vec![
        Span::styled(" q ", Style::default().fg(colors::yellow())),
        Span::styled("退出", Style::default().fg(colors::muted())),
        Span::raw("  "),
        Span::styled("Ctrl+C", Style::default().fg(colors::yellow())),
    ]));

    let sidebar = Paragraph::new(lines).style(Style::default().bg(colors::bg()));
    frame.render_widget(sidebar, area);
}
