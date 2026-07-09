//! 侧边栏导航 — 显示所有功能页，高亮当前页

use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Paragraph};
use ratatui::Frame;

use crate::app::{colors, App, Tab};

pub fn render(frame: &mut Frame, app: &App, area: Rect) {
    // 侧边栏容器
    let block = Block::default()
        .borders(Borders::RIGHT)
        .border_style(Style::default().fg(colors::BORDER))
        .style(Style::default().bg(colors::BG));
    frame.render_widget(block, area);

    // 构建侧边栏内容
    let mut lines: Vec<Line> = Vec::new();

    // Logo 区
    lines.push(Line::from(vec![
        Span::raw(" "),
        Span::styled("◈ ", Style::default().fg(colors::PRIMARY)),
        Span::styled("PRECIS", Style::default().fg(colors::FG).add_modifier(Modifier::BOLD)),
    ]));
    lines.push(Line::from(Span::styled(
        " ──────────────────",
        Style::default().fg(colors::BORDER),
    )));
    lines.push(Line::from(""));

    // 导航项
    for (i, tab) in Tab::all().iter().enumerate() {
        let is_active = *tab == app.current_tab;
        let (icon_color, label_style) = if is_active {
            (colors::PRIMARY, Style::default().fg(colors::FG).add_modifier(Modifier::BOLD))
        } else {
            (colors::MUTED, Style::default().fg(colors::MUTED))
        };

        let prefix = if is_active { "▶ " } else { "  " };
        let num = format!("{}", i + 1);

        let line = Line::from(vec![
            Span::raw(prefix),
            Span::styled(format!("{} ", tab.icon()), Style::default().fg(icon_color)),
            Span::styled(format!("{:<10}", tab.label()), label_style),
            Span::styled(format!(" {}", num), Style::default().fg(colors::MUTED)),
        ]);

        // 活跃项加背景高亮
        let line = if is_active {
            line.style(Style::default().bg(colors::PANEL))
        } else {
            line
        };

        lines.push(line);
    }

    lines.push(Line::from(""));
    lines.push(Line::from(Span::styled(
        " ──────────────────",
        Style::default().fg(colors::BORDER),
    )));

    // 快捷键提示
    lines.push(Line::from(vec![
        Span::styled(" 快捷键", Style::default().fg(colors::MUTED).add_modifier(Modifier::BOLD)),
    ]));
    lines.push(Line::from(vec![
        Span::styled("  q  ", Style::default().fg(colors::PRIMARY)),
        Span::styled("退出", Style::default().fg(colors::MUTED)),
    ]));
    lines.push(Line::from(vec![
        Span::styled("  v  ", Style::default().fg(colors::PRIMARY)),
        Span::styled("校验", Style::default().fg(colors::MUTED)),
    ]));
    lines.push(Line::from(vec![
        Span::styled("  F2 ", Style::default().fg(colors::PRIMARY)),
        Span::styled("动效开关", Style::default().fg(colors::MUTED)),
    ]));

    let sidebar = Paragraph::new(lines).style(Style::default().bg(colors::BG));
    frame.render_widget(sidebar, area);
}
