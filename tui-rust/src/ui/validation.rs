//! 校验页：触发校验 + 结果展示（DataTable + 摘要）

use ratatui::layout::{Constraint, Direction, Layout};
use ratatui::style::{Color, Modifier, Style};
use ratatui::widgets::{Block, Borders, Clear, Paragraph, Row, Table, TableState, Wrap};
use ratatui::Frame;

use crate::app::{App, ValidationState};
use crate::ui::colors;

pub fn render(frame: &mut Frame, app: &mut App, area: ratatui::layout::Rect) {
    let (_, fg, primary, _accent, green, red, yellow, muted) = colors();

    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(3), Constraint::Length(8), Constraint::Min(1)])
        .split(area);

    // 操作提示
    let hint_text = match &app.validation {
        ValidationState::Idle => "按 v 执行校验 (validate)".to_string(),
        ValidationState::Validating => "校验中... (后台异步执行)".to_string(),
        ValidationState::Done(_) => "校验完成 · ↑↓ 浏览错误 · v 重新校验".to_string(),
        ValidationState::Failed(e) => format!("校验失败: {} · 按 v 重试", &e[..e.len().min(60)]),
    };
    let hint = Paragraph::new(hint_text)
        .style(Style::default().fg(muted))
        .block(
            Block::default()
                .borders(Borders::BOTTOM)
                .border_style(Style::default().fg(Color::Rgb(45, 53, 72))),
        );
    frame.render_widget(hint, chunks[0]);

    // 摘要面板
    match &app.validation {
        ValidationState::Idle => {
            let p = Paragraph::new("未执行校验。")
                .style(Style::default().fg(muted))
                .alignment(ratatui::layout::Alignment::Center);
            frame.render_widget(p, chunks[1]);
        }
        ValidationState::Validating => {
            let p = Paragraph::new("⏳ 校验中...")
                .style(Style::default().fg(yellow).add_modifier(Modifier::BOLD))
                .alignment(ratatui::layout::Alignment::Center);
            frame.render_widget(p, chunks[1]);
        }
        ValidationState::Failed(err) => {
            let p = Paragraph::new(format!("❌ {}\n{}", "校验失败", err))
                .style(Style::default().fg(red))
                .wrap(Wrap { trim: true });
            frame.render_widget(p, chunks[1]);
        }
        ValidationState::Done(resp) => {
            let s = &resp.summary;
            let total = s.total_error_count;
            let color = if total == 0 { green } else { red };
            let summary = Paragraph::new(vec![
                ratatui::text::Line::from(vec![
                    ratatui::text::Span::styled("校验结果  ", Style::default().fg(primary).add_modifier(Modifier::BOLD)),
                    ratatui::text::Span::styled(
                        format!("{} 个错误", total),
                        Style::default().fg(color).add_modifier(Modifier::BOLD),
                    ),
                    ratatui::text::Span::styled(format!("  ·  {}ms", s.duration_ms), Style::default().fg(muted)),
                ]),
                ratatui::text::Line::from(""),
                ratatui::text::Line::from(vec![
                    ratatui::text::Span::styled("数据表: ", Style::default().fg(muted)),
                    ratatui::text::Span::styled(format!("{} 个  ", s.tables_loaded), Style::default().fg(fg)),
                    ratatui::text::Span::styled("文件: ", Style::default().fg(muted)),
                    ratatui::text::Span::styled(format!("{}/{}  ", s.files_loaded, s.files_total), Style::default().fg(fg)),
                    ratatui::text::Span::styled("耗时: ", Style::default().fg(muted)),
                    ratatui::text::Span::styled(format!("{}ms", s.duration_ms), Style::default().fg(fg)),
                ]),
                ratatui::text::Line::from(vec![
                    ratatui::text::Span::styled("错误分布: ", Style::default().fg(muted)),
                    ratatui::text::Span::styled(
                        format!("格式 {} · 约束 {} · 加载 {}", s.format_error_count, s.constraint_error_count, s.loading_error_count),
                        Style::default().fg(fg),
                    ),
                ]),
            ])
            .style(Style::default().bg(Color::Rgb(26, 27, 38)))
            .block(Block::default().padding(ratatui::widgets::Padding::horizontal(1)));
            frame.render_widget(summary, chunks[1]);
        }
    }

    // 错误表格
    match &app.validation {
        ValidationState::Done(resp) if !resp.errors.is_empty() => {
            let header = ["表", "字段", "行号", "类型", "消息"];
            let rows: Vec<Row> = resp
                .errors
                .iter()
                .take(200) // 限制显示前 200 条
                .map(|e| {
                    Row::new(vec![
                        e.table.clone(),
                        e.column.clone(),
                        e.row_index.map(|r| r.to_string()).unwrap_or_default(),
                        e.error_type.clone(),
                        e.message.chars().take(60).collect::<String>(),
                    ])
                })
                .collect();

            let table = Table::new(
                rows,
                [Constraint::Percentage(15), Constraint::Percentage(15), Constraint::Percentage(8), Constraint::Percentage(15), Constraint::Percentage(47)],
            )
            .header(
                Row::new(header.iter().map(|h| ratatui::text::Span::styled(*h, Style::default().fg(muted).add_modifier(Modifier::BOLD))))
                    .style(Style::default().bg(Color::Rgb(36, 40, 59))),
            )
            .row_highlight_style(Style::default().bg(Color::Rgb(36, 40, 59)).fg(primary))
            .style(Style::default().bg(Color::Rgb(22, 22, 30)));

            let mut state = TableState::default();
            state.select(Some(0));
            frame.render_stateful_widget(table, chunks[2], &mut state);
        }
        ValidationState::Done(_) => {
            let p = Paragraph::new("✓ 校验通过，无错误！")
                .style(Style::default().fg(green).add_modifier(Modifier::BOLD))
                .alignment(ratatui::layout::Alignment::Center);
            frame.render_widget(p, chunks[2]);
        }
        _ => {
            // 占位
            frame.render_widget(Clear, chunks[2]);
        }
    }
}
