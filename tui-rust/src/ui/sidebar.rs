//! 侧边栏导航 — SURFACE 底色（和标题/状态栏统一），icons 字符

use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style, Stylize};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Paragraph};
use ratatui::Frame;

use crate::app::{colors, App, Tab};
use crate::icons;

pub fn render(frame: &mut Frame, app: &App, area: Rect) {
    // 容器：SURFACE 底色（统一，不断层）+ 右分隔线
    let block = Block::default()
        .borders(Borders::RIGHT)
        .border_style(Style::default().fg(colors::BORDER))
        .style(Style::default().bg(colors::SURFACE));
    frame.render_widget(block, area);

    let inner_width = area.width.saturating_sub(2) as usize; // 减右边框 + padding
    let mut lines: Vec<Line> = Vec::new();

    // Logo 区
    lines.push(Line::from(vec![
        Span::raw(" "),
        Span::styled(format!("{} ", icons::LOGO), Style::default().fg(colors::PRIMARY)),
        Span::styled("PRECIS", Style::default().fg(colors::FG).add_modifier(Modifier::BOLD)),
    ]));

    // 动态宽度分隔线
    lines.push(Line::from(Span::styled(
        format!(" {}", icons::divider(inner_width)),
        Style::default().fg(colors::BORDER),
    )));
    lines.push(Line::from(""));

    // 导航项
    for (i, tab) in Tab::all().iter().enumerate() {
        let is_active = *tab == app.current_tab;
        let name_style = if is_active {
            Style::default().fg(colors::FG).add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(colors::MUTED)
        };
        let icon_style = if is_active {
            Style::default().fg(colors::PRIMARY)
        } else {
            Style::default().fg(colors::MUTED)
        };

        let prefix = if is_active {
            Span::styled(format!(" {} ", icons::SELECTED), Style::default().fg(colors::PRIMARY))
        } else {
            Span::raw("   ")
        };

        let line = Line::from(vec![
            prefix,
            Span::styled(format!("{} ", tab.icon()), icon_style),
            Span::styled(format!("{:<8}", tab.label()), name_style),
            Span::styled(format!("{}", i + 1), Style::default().fg(colors::MUTED)),
        ])
        .style(if is_active {
            Style::default().bg(colors::PANEL)
        } else {
            Style::default()
        });

        lines.push(line);
    }

    lines.push(Line::from(""));
    lines.push(Line::from(Span::styled(
        format!(" {}", icons::divider(inner_width)),
        Style::default().fg(colors::BORDER),
    )));

    // 快捷键区
    lines.push(Line::from(vec![
        Span::raw(" "),
        Span::styled("Keys", Style::default().fg(colors::MUTED).add_modifier(Modifier::BOLD)),
    ]));

    let keys = [
        ("q", "退出"),
        ("v", "校验"),
        ("1-5", "页面"),
        ("Tab", "下一个"),
        ("F2", "动效"),
    ];
    for (k, desc) in keys {
        lines.push(Line::from(vec![
            Span::raw(" "),
            Span::styled(format!(" {:>3} ", k), Style::default().fg(colors::PRIMARY)),
            Span::styled(desc, Style::default().fg(colors::MUTED)),
        ]));
    }

    let sidebar = Paragraph::new(lines).style(Style::default().bg(colors::SURFACE));
    frame.render_widget(sidebar, area);
}
