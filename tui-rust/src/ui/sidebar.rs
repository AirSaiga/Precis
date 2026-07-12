//! 侧边栏 — tab 图标 + ▸ 选中指示（Synthwave 风格）

use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;
use ratatui::Frame;

use crate::app::{colors, App, Tab};
use crate::icons;

pub fn render(frame: &mut Frame, app: &App, area: Rect) {
    let mut lines: Vec<Line> = Vec::new();

    // 顶部留白
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

        let (prefix, prefix_style) = if active {
            ("▸", Style::default().fg(colors::pink()).add_modifier(Modifier::BOLD))
        } else {
            (" ", Style::default().fg(colors::dim()))
        };
        let icon_style = if active {
            Style::default().fg(colors::pink())
        } else {
            Style::default().fg(colors::dim())
        };
        let name_style = if active {
            Style::default().fg(colors::fg()).add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(colors::muted())
        };
        let num_style = if active {
            Style::default().fg(colors::pink())
        } else {
            Style::default().fg(colors::dim())
        };
        let bg = if active { colors::panel() } else { colors::bg() };

        lines.push(Line::from(vec![
            Span::styled(format!(" {} ", prefix), prefix_style),
            Span::styled(format!("{} ", i + 1), num_style),
            Span::styled(format!("{} ", icon), icon_style),
            Span::styled(tab.label(), name_style),
        ]).style(Style::default().bg(bg)));

        // 项之间留白
        lines.push(Line::from(""));
    }

    // 底部留白 + 快捷键提示
    let pad = area.height.saturating_sub(lines.len() as u16 + 2);
    for _ in 0..pad {
        lines.push(Line::from(""));
    }

    lines.push(Line::from(vec![
        Span::styled(" F2 ", Style::default().fg(colors::dim())),
        Span::styled("动效", Style::default().fg(colors::dim())),
    ]));
    lines.push(Line::from(vec![
        Span::styled(" F3 ", Style::default().fg(colors::dim())),
        Span::styled("主题", Style::default().fg(colors::dim())),
    ]));
    lines.push(Line::from(vec![
        Span::styled(" q  ", Style::default().fg(colors::dim())),
        Span::styled("退出", Style::default().fg(colors::dim())),
    ]));

    let sidebar = Paragraph::new(lines).style(Style::default().bg(colors::bg()));
    frame.render_widget(sidebar, area);
}
