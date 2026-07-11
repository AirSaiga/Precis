//! 侧边栏 — 极简纯文字导航（Linear 风格：无图标、无边框、留白）

use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style, Stylize};
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;
use ratatui::Frame;

use crate::app::{colors, App, Tab};

pub fn render(frame: &mut Frame, app: &App, area: Rect) {
    let mut lines: Vec<Line> = Vec::new();

    // 顶部留白
    lines.push(Line::from(""));

    // 导航项
    for (i, tab) in Tab::all().iter().enumerate() {
        let active = *tab == app.current_tab;
        let name_style = if active {
            Style::default().fg(colors::FG).add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(colors::MUTED)
        };
        let num_style = if active {
            Style::default().fg(colors::PINK)
        } else {
            Style::default().fg(colors::DIM)
        };
        let bg = if active { colors::PANEL } else { colors::BG };

        lines.push(Line::from(vec![
            Span::styled(format!(" {} ", i + 1), num_style),
            Span::styled(format!(" {}", tab.label()), name_style),
        ]).style(Style::default().bg(bg)));

        // 项之间留白
        lines.push(Line::from(""));
    }

    // 底部留白 + 快捷键提示（极简）
    let pad = area.height.saturating_sub(lines.len() as u16 + 4);
    for _ in 0..pad {
        lines.push(Line::from(""));
    }

    lines.push(Line::from(vec![
        Span::styled(" q ", Style::default().fg(colors::DIM)),
        Span::styled("退出", Style::default().fg(colors::DIM)),
    ]));
    lines.push(Line::from(vec![
        Span::styled(" v ", Style::default().fg(colors::DIM)),
        Span::styled("校验", Style::default().fg(colors::DIM)),
    ]));

    let sidebar = Paragraph::new(lines).style(Style::default().bg(colors::BG));
    frame.render_widget(sidebar, area);
}
