//! 校验页：触发校验 + 结果展示（摘要面板 + 错误表格）

use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Modifier, Style, Stylize};
use ratatui::widgets::{Block, Borders, Clear, Padding, Paragraph, Row, Table, TableState};
use ratatui::Frame;

use crate::app::{colors, App, ValidationState};

pub fn render(frame: &mut Frame, app: &mut App, area: Rect) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(2), Constraint::Length(8), Constraint::Min(1)])
        .split(area);

    // 操作提示
    let hint_text = match &app.validation {
        ValidationState::Idle => "  按 v 执行校验".to_string(),
        ValidationState::Validating => "  ⏳ 校验中...".to_string(),
        ValidationState::Done(_) => "  校验完成 · v 重新校验".to_string(),
        ValidationState::Failed(_) => "  ❌ 校验失败 · 按 v 重试".to_string(),
    };
    let hint = Paragraph::new(hint_text)
        .style(Style::default().fg(colors::MUTED))
        .block(
            Block::default()
                .borders(Borders::BOTTOM)
                .border_style(Style::default().fg(colors::BORDER)),
        );
    frame.render_widget(hint, chunks[0]);

    // 摘要面板
    render_summary(frame, app, chunks[1]);

    // 错误表格 / 空状态
    render_errors(frame, app, chunks[2]);
}

fn render_summary(frame: &mut Frame, app: &App, area: Rect) {
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(colors::BORDER))
        .bg(colors::SURFACE)
        .padding(Padding::horizontal(1));

    let content = match &app.validation {
        ValidationState::Idle => Paragraph::new("  未执行校验。按 v 开始。")
            .style(Style::default().fg(colors::MUTED))
            .block(block),
        ValidationState::Validating => {
            // 旋转动画
            let spinner = match app.frame_count % 4 {
                0 => "⠋",
                1 => "⠙",
                2 => "⠹",
                _ => "⠸",
            };
            Paragraph::new(format!("  {} 校验中...", spinner))
                .style(Style::default().fg(colors::YELLOW).add_modifier(Modifier::BOLD))
                .block(block)
        }
        ValidationState::Failed(err) => Paragraph::new(format!("  ❌ {}\n  {}", "校验失败", err))
            .style(Style::default().fg(colors::RED))
            .block(block),
        ValidationState::Done(resp) => {
            let s = &resp.summary;
            let total = s.total_error_count;
            let err_color = if total == 0 { colors::GREEN } else { colors::RED };
            Paragraph::new(vec![
                ratatui::text::Line::from(vec![
                    ratatui::text::Span::styled(
                        format!("  {} ", if total == 0 { "✓" } else { "✗" }),
                        Style::default().fg(err_color).add_modifier(Modifier::BOLD),
                    ),
                    ratatui::text::Span::styled(
                        format!("{}", total),
                        Style::default().fg(err_color).add_modifier(Modifier::BOLD),
                    ),
                    ratatui::text::Span::styled(" 个错误  ", Style::default().fg(colors::FG)),
                    ratatui::text::Span::styled(
                        format!("· {} 表 · {} 文件 · {}ms", s.tables_loaded, s.files_loaded, s.duration_ms),
                        Style::default().fg(colors::MUTED),
                    ),
                ]),
                ratatui::text::Line::from(""),
                ratatui::text::Line::from(vec![
                    ratatui::text::Span::styled("  格式 ", Style::default().fg(colors::MUTED)),
                    ratatui::text::Span::styled(format!("{}", s.format_error_count), Style::default().fg(colors::YELLOW)),
                    ratatui::text::Span::styled("  约束 ", Style::default().fg(colors::MUTED)),
                    ratatui::text::Span::styled(format!("{}", s.constraint_error_count), Style::default().fg(colors::YELLOW)),
                    ratatui::text::Span::styled("  加载 ", Style::default().fg(colors::MUTED)),
                    ratatui::text::Span::styled(format!("{}", s.loading_error_count), Style::default().fg(colors::YELLOW)),
                ]),
            ])
            .block(block)
        }
    };
    frame.render_widget(content, area);
}

fn render_errors(frame: &mut Frame, app: &App, area: Rect) {
    match &app.validation {
        ValidationState::Done(resp) if !resp.errors.is_empty() => {
            let header_cells = ["表", "字段", "行号", "类型", "消息"];
            let header = Row::new(header_cells.iter().map(|h| {
                ratatui::text::Span::styled(*h, Style::default().fg(colors::MUTED).add_modifier(Modifier::BOLD))
            }))
            .style(Style::default().bg(colors::PANEL));

            let rows: Vec<Row> = resp
                .errors
                .iter()
                .take(200)
                .enumerate()
                .map(|(i, e)| {
                    let style = if i % 2 == 0 {
                        Style::default().bg(colors::BG)
                    } else {
                        Style::default().bg(colors::SURFACE)
                    };
                    Row::new(vec![
                        e.table.clone(),
                        e.column.clone(),
                        e.row_index.map(|r| r.to_string()).unwrap_or_default(),
                        e.error_type.clone(),
                        e.message.chars().take(50).collect::<String>(),
                    ])
                    .style(style)
                })
                .collect();

            let table = Table::new(
                rows,
                [
                    Constraint::Percentage(15),
                    Constraint::Percentage(15),
                    Constraint::Percentage(8),
                    Constraint::Percentage(17),
                    Constraint::Percentage(45),
                ],
            )
            .header(header)
            .row_highlight_style(Style::default().bg(colors::BOOST).fg(colors::PRIMARY))
            .block(
                Block::default()
                    .borders(Borders::TOP)
                    .border_style(Style::default().fg(colors::BORDER))
                    .bg(colors::BG),
            );

            let mut state = TableState::default();
            state.select(Some(0));
            frame.render_stateful_widget(table, area, &mut state);
        }
        ValidationState::Done(_) => {
            let p = Paragraph::new("\n  ✓ 校验通过，无错误！")
                .style(Style::default().fg(colors::GREEN).add_modifier(Modifier::BOLD));
            frame.render_widget(p, area);
        }
        _ => {
            frame.render_widget(Clear, area);
        }
    }
}
