//! 校验页：紧凑摘要 + 错误表格（可滚动 + 斑马纹 + 省略号）

use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Modifier, Style, Stylize};
use ratatui::text::Span;
use ratatui::widgets::{Block, Borders, Padding, Paragraph, Row, Table, TableState};
use ratatui::Frame;

use crate::app::{colors, App, ValidationState};
use crate::icons;

pub fn render(frame: &mut Frame, app: &mut App, area: Rect) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(1), Constraint::Length(5), Constraint::Min(1)])
        .split(area);

    // 提示行
    let hint = match &app.validation {
        ValidationState::Idle => "  按 v 执行校验".to_string(),
        ValidationState::Validating => "  校验中...".to_string(),
        ValidationState::Done(_) => "  校验完成  j/k 滚动  v 重新校验".to_string(),
        ValidationState::Failed(_) => "  校验失败  按 v 重试".to_string(),
    };
    frame.render_widget(
        Paragraph::new(hint).style(Style::default().fg(colors::MUTED)),
        chunks[0],
    );

    render_summary(frame, app, chunks[1]);
    render_errors(frame, app, chunks[2]);
}

fn render_summary(frame: &mut Frame, app: &App, area: Rect) {
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(colors::BORDER))
        .bg(colors::SURFACE)
        .padding(Padding::horizontal(2));

    let content = match &app.validation {
        ValidationState::Idle => Paragraph::new("尚未校验，按 v 开始")
            .style(Style::default().fg(colors::MUTED))
            .block(block),

        ValidationState::Validating => {
            let spinner = match app.frame_count % 6 {
                0 => "⠋", 1 => "⠙", 2 => "⠹", 3 => "⠸", 4 => "⠼", _ => "⠴",
            };
            Paragraph::new(format!("{} 校验中...", spinner))
                .style(Style::default().fg(colors::YELLOW).add_modifier(Modifier::BOLD))
                .block(block)
        }

        ValidationState::Failed(err) => {
            let msg = icons::truncate(err, area.width as usize - 6);
            Paragraph::new(format!("{} {}", icons::result::FAIL, msg))
                .style(Style::default().fg(colors::RED))
                .block(block)
        }

        ValidationState::Done(resp) => {
            let s = &resp.summary;
            let total = s.total_error_count;
            let pass = total == 0;
            let icon_color = if pass { colors::GREEN } else { colors::RED };

            Paragraph::new(vec![
                ratatui::text::Line::from(vec![
                    Span::raw(" "),
                    Span::styled(
                        format!("{} ", if pass { icons::result::PASS } else { icons::result::FAIL }),
                        Style::default().fg(icon_color).add_modifier(Modifier::BOLD),
                    ),
                    Span::styled(
                        format!("{}", total),
                        Style::default().fg(icon_color).add_modifier(Modifier::BOLD),
                    ),
                    Span::styled(" 个错误  ", Style::default().fg(colors::FG)),
                    Span::styled(
                        format!("{} 表  {} 文件  {}ms", s.tables_loaded, s.files_loaded, s.duration_ms),
                        Style::default().fg(colors::MUTED),
                    ),
                ]),
                ratatui::text::Line::from(""),
                ratatui::text::Line::from(vec![
                    Span::raw(" "),
                    Span::styled("格式 ", Style::default().fg(colors::MUTED)),
                    Span::styled(format!("{}", s.format_error_count), Style::default().fg(colors::YELLOW)),
                    Span::styled("   约束 ", Style::default().fg(colors::MUTED)),
                    Span::styled(format!("{}", s.constraint_error_count), Style::default().fg(colors::YELLOW)),
                    Span::styled("   加载 ", Style::default().fg(colors::MUTED)),
                    Span::styled(format!("{}", s.loading_error_count), Style::default().fg(colors::YELLOW)),
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
            let header_cells = ["Table", "Column", "Row", "Type", "Message"];
            let header = Row::new(header_cells.iter().map(|h| {
                Span::styled(*h, Style::default().fg(colors::MUTED).add_modifier(Modifier::BOLD))
            }))
            .style(Style::default().bg(colors::PANEL));

            let display_count = resp.errors.len().min(500);
            let rows: Vec<Row> = resp
                .errors
                .iter()
                .take(500)
                .enumerate()
                .map(|(i, e)| {
                    let style = if i % 2 == 0 {
                        Style::default().bg(colors::BG)
                    } else {
                        Style::default().bg(colors::SURFACE)
                    };
                    Row::new(vec![
                        icons::truncate(&e.table, 18),
                        icons::truncate(&e.column, 18),
                        e.row_index.map(|r| r.to_string()).unwrap_or_default(),
                        icons::truncate(&e.error_type, 16),
                        icons::truncate(&e.message, area.width as usize / 3),
                    ])
                    .style(style)
                })
                .collect();

            let table = Table::new(
                rows,
                [
                    Constraint::Length(20),
                    Constraint::Length(20),
                    Constraint::Length(6),
                    Constraint::Length(18),
                    Constraint::Min(10),
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
            state.select(Some(app.error_cursor.min(display_count.saturating_sub(1))));
            frame.render_stateful_widget(table, area, &mut state);
        }
        ValidationState::Done(_) => {
            let p = Paragraph::new("\n  ✓ 校验通过，无错误")
                .style(Style::default().fg(colors::GREEN).add_modifier(Modifier::BOLD));
            frame.render_widget(p, area);
        }
        _ => {}
    }
}
