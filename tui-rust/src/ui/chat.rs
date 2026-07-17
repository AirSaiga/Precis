//! AI 对话页 — 角色竖条气泡 + 手动换行（尾部截断）+ 聚焦输入框

use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, BorderType, Borders, Paragraph};
use ratatui::Frame;

use super::widgets;
use crate::app::{colors, layout, App};
use crate::icons;

pub fn render(frame: &mut Frame, app: &mut App, area: Rect) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Min(1), Constraint::Length(layout::CHAT_INPUT)])
        .split(area);

    render_messages(frame, app, chunks[0]);
    render_input(frame, app, chunks[1]);
}

/// 消息流：角色竖条 + 内容缩进换行；只渲染尾部可见行（自动停在最新消息）
fn render_messages(frame: &mut Frame, app: &App, area: Rect) {
    if app.chat_messages.is_empty() {
        // 空态：图标 + keychip 提示组
        frame.render_widget(
            Paragraph::new(vec![
                Line::from(""),
                Line::from(vec![
                    Span::styled(format!("  {} ", icons::tab::CHAT), Style::default().fg(colors::gradient_a())),
                    Span::styled(
                        "AI 对话",
                        Style::default().fg(colors::fg()).add_modifier(Modifier::BOLD),
                    ),
                ]),
                Line::from(""),
                widgets::chips_line(&[("Enter", "聚焦输入"), ("Esc", "取消聚焦")]),
                Line::from(Span::styled(
                    "  需要先在 Provider 页配置并激活一个 Provider",
                    Style::default().fg(colors::dim()),
                )),
            ]),
            area,
        );
        return;
    }

    // 手动换行（宽度 = 区域宽 - 缩进），保证行数可预测
    let wrap_width = (area.width as usize).saturating_sub(4).max(8);
    let mut lines: Vec<Line> = Vec::new();
    for msg in &app.chat_messages {
        let (role_label, role_color) = match msg.role.as_str() {
            "user" => ("你", colors::cyan()),
            "assistant" => ("AI", colors::green()),
            _ => ("?", colors::muted()),
        };
        lines.push(Line::from(vec![
            Span::raw(" "),
            Span::styled(
                icons::BAR_THIN,
                Style::default().fg(role_color).add_modifier(Modifier::BOLD),
            ),
            Span::styled(
                format!(" {}", role_label),
                Style::default().fg(role_color).add_modifier(Modifier::BOLD),
            ),
        ]));
        for seg in widgets::wrap_text(&msg.content, wrap_width) {
            lines.push(Line::from(Span::styled(
                format!("   {}", seg),
                Style::default().fg(colors::fg()),
            )));
        }
        lines.push(Line::from(""));
    }
    if app.chat_loading {
        lines.push(Line::from(vec![
            Span::raw(" "),
            Span::styled(
                icons::spinner(app.frame_count),
                Style::default().fg(colors::gradient_a()),
            ),
            Span::styled(" AI 思考中...", Style::default().fg(colors::muted())),
        ]));
    }

    // 尾部截断：只保留最后 height 行（最新消息可见）
    let visible = area.height as usize;
    let start = lines.len().saturating_sub(visible);
    let tail: Vec<Line> = lines.split_off(start);
    frame.render_widget(
        Paragraph::new(tail).style(Style::default().bg(colors::bg())),
        area,
    );
}

/// 输入框：聚焦时主题色边框；空输入未聚焦显示 placeholder
fn render_input(frame: &mut Frame, app: &App, area: Rect) {
    let border_color = if app.chat_focused { colors::gradient_a() } else { colors::border() };
    let input_block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(Style::default().fg(border_color))
        .style(Style::default().bg(colors::surface()));

    let inner = input_block.inner(area);
    frame.render_widget(input_block, area);
    if inner.height == 0 || inner.width == 0 {
        return;
    }

    let input_line = if app.chat_input.is_empty() && !app.chat_focused {
        Line::from(Span::styled(
            " 输入消息... Enter 发送",
            Style::default().fg(colors::dim()),
        ))
    } else {
        // 光标闪烁（约 0.5s 周期）
        let cursor_style = if app.frame_count % 16 < 8 {
            Style::default().fg(colors::gradient_a()).add_modifier(Modifier::REVERSED)
        } else {
            Style::default().bg(colors::surface()).fg(colors::fg())
        };
        Line::from(vec![
            Span::raw(" "),
            Span::styled(app.chat_input.clone(), Style::default().fg(colors::fg())),
            Span::styled(" ", cursor_style),
        ])
    };

    frame.render_widget(
        Paragraph::new(input_line).style(Style::default().bg(colors::surface())),
        inner,
    );
}
