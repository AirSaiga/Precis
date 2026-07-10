//! AI 对话页 — 消息流 + 输入框

use std::io::Write;

use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Modifier, Style, Stylize};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Paragraph};
use ratatui::Frame;

use crate::app::{colors, App};

pub fn render(frame: &mut Frame, app: &mut App, area: Rect) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Min(1), Constraint::Length(3)])
        .split(area);

    // 消息流
    let mut lines: Vec<Line> = Vec::new();
    lines.push(Line::from(""));

    if app.chat_messages.is_empty() {
        lines.push(Line::from(""));
        lines.push(Line::from(Span::styled(
            "  AI 对话 — 输入消息后回车发送",
            Style::default().fg(colors::DIM),
        )));
        lines.push(Line::from(Span::styled(
            "  需要先在 Provider 页配置并激活一个 Provider",
            Style::default().fg(colors::DIM),
        )));
    } else {
        for msg in &app.chat_messages {
            let (role_label, role_color) = match msg.role.as_str() {
                "user" => ("你", colors::PRIMARY),
                "assistant" => ("AI", colors::GREEN),
                _ => ("?", colors::MUTED),
            };
            lines.push(Line::from(vec![
                Span::styled(format!("  {} ", role_label), Style::default().fg(role_color).add_modifier(Modifier::BOLD)),
                Span::styled(&msg.content, Style::default().fg(colors::FG)),
            ]));
            lines.push(Line::from(""));
        }
    }

    // 正在等待响应
    if app.chat_loading {
        let s = match app.frame_count % 6 { 0 => "⠋", 1 => "⠙", 2 => "⠹", 3 => "⠸", 4 => "⠼", _ => "⠴" };
        lines.push(Line::from(Span::styled(
            format!("  {} AI 思考中...", s),
            Style::default().fg(colors::MUTED),
        )));
    }

    frame.render_widget(
        Paragraph::new(lines).style(Style::default().bg(colors::BG)),
        chunks[0],
    );

    // 输入框
    let input_style = Style::default().bg(colors::SURFACE).fg(colors::FG);
    let prompt_style = Style::default().fg(colors::PRIMARY);

    let cursor_style = if app.frame_count % 30 < 15 {
        Style::default().fg(colors::PRIMARY).add_modifier(Modifier::REVERSED)
    } else {
        input_style
    };

    let input_line = Line::from(vec![
        Span::styled(" > ", prompt_style),
        Span::styled(&app.chat_input, input_style),
        Span::styled(" ", cursor_style), // 光标位置（REVERSED 反白，不覆盖字符）
    ]);

    frame.render_widget(
        Paragraph::new(input_line).style(Style::default().bg(colors::SURFACE)),
        chunks[1],
    );
}
