//! AI 对话页 — 消息流 + 圆角输入框

use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, BorderType, Borders, Paragraph};
use ratatui::Frame;

use crate::app::{colors, layout, App};
use crate::icons;

pub fn render(frame: &mut Frame, app: &mut App, area: Rect) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Min(1),
            Constraint::Length(layout::CHAT_INPUT),
        ])
        .split(area);

    // 消息流
    let mut lines: Vec<Line> = Vec::new();
    lines.push(Line::from(""));

    if app.chat_messages.is_empty() {
        lines.push(Line::from(""));
        lines.push(Line::from(vec![
            Span::styled("  ◎ ", Style::default().fg(colors::dim())),
            Span::styled("AI 对话 — 输入消息后回车发送", Style::default().fg(colors::dim())),
        ]));
        lines.push(Line::from(Span::styled(
            "  需要先在 Provider 页配置并激活一个 Provider",
            Style::default().fg(colors::dim()),
        )));
    } else {
        for msg in &app.chat_messages {
            let (role_icon, role_label, role_color) = match msg.role.as_str() {
                "user" => ("◈", "你", colors::cyan()),
                "assistant" => ("◎", "AI", colors::green()),
                _ => ("?", "?", colors::muted()),
            };
            lines.push(Line::from(vec![
                Span::styled(format!("  {} ", role_icon), Style::default().fg(role_color).add_modifier(Modifier::BOLD)),
                Span::styled(role_label, Style::default().fg(role_color).add_modifier(Modifier::BOLD)),
            ]));
            lines.push(Line::from(Span::styled(format!("  {}", msg.content), Style::default().fg(colors::fg()))));
            lines.push(Line::from(""));
        }
    }

    // 正在等待响应
    if app.chat_loading {
        lines.push(Line::from(vec![
            Span::styled(format!("  {} ", icons::spinner(app.frame_count)), Style::default().fg(colors::pink())),
            Span::styled("AI 思考中...", Style::default().fg(colors::muted())),
        ]));
    }

    frame.render_widget(
        Paragraph::new(lines).style(Style::default().bg(colors::bg())),
        chunks[0],
    );

    // 输入框（圆角边框）
    let border_color = if app.chat_focused { colors::pink() } else { colors::dim() };
    let input_block = Block::default()
        .borders(Borders::all())
        .border_type(BorderType::Rounded)
        .border_style(Style::default().fg(border_color))
        .style(Style::default().bg(colors::surface()));

    let input_inner = input_block.inner(chunks[1]);
    frame.render_widget(input_block, chunks[1]);

    let cursor_style = if app.frame_count % 30 < 15 {
        Style::default().fg(colors::pink()).add_modifier(Modifier::REVERSED)
    } else {
        Style::default().bg(colors::surface()).fg(colors::fg())
    };

    let input_line = Line::from(vec![
        Span::styled("▌ ", Style::default().fg(colors::pink())),
        Span::styled(&app.chat_input, Style::default().fg(colors::fg())),
        Span::styled(" ", cursor_style),
    ]);

    frame.render_widget(
        Paragraph::new(input_line).style(Style::default().bg(colors::surface())),
        input_inner,
    );
}
