//! 校验页 — 大号数字摘要 + 进度条 + 错误分布 + 斑马表格

use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Paragraph, Row, Table, TableState};
use ratatui::Frame;

use crate::app::{colors, layout, App, ValidationState};
use crate::icons;

pub fn render(frame: &mut Frame, app: &mut App, area: Rect) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(layout::VALIDATION_HINT),
            Constraint::Length(layout::VALIDATION_SUMMARY),
            Constraint::Min(1),
        ])
        .split(area);

    // 提示行
    let hint: String = match &app.validation {
        ValidationState::Idle => "  按 v 执行校验".to_string(),
        ValidationState::Validating => {
            format!("  {} 校验中...", icons::spinner(app.frame_count))
        }
        ValidationState::Done(_) => "  校验完成  j/k 浏览  v 重新校验".to_string(),
        ValidationState::Failed(_) => "  校验失败  按 v 重试".to_string(),
    };
    frame.render_widget(
        Paragraph::new(hint).style(Style::default().fg(colors::pink())),
        chunks[0],
    );

    // 摘要区
    render_summary(frame, app, chunks[1]);

    // 错误表格
    render_errors(frame, app, chunks[2]);
}

fn render_summary(frame: &mut Frame, app: &App, area: Rect) {
    let lines = match &app.validation {
        ValidationState::Idle => vec![
            Line::from(""),
            Line::from(Span::styled("  尚未校验", Style::default().fg(colors::dim()))),
        ],
        ValidationState::Validating => vec![
            Line::from(""),
            Line::from(Span::styled("  · · ·", Style::default().fg(colors::muted()))),
        ],
        ValidationState::Failed(err) => {
            let msg = icons::truncate(err, 60);
            vec![
                Line::from(""),
                Line::from(vec![
                    Span::styled("  ✗ ", Style::default().fg(colors::red())),
                    Span::styled("校验失败", Style::default().fg(colors::red()).add_modifier(Modifier::BOLD)),
                ]),
                Line::from(Span::styled(format!("  {}", msg), Style::default().fg(colors::muted()))),
            ]
        }
        ValidationState::Done(resp) => {
            let s = &resp.summary;
            let total = s.total_error_count;
            let pass = total == 0;

            let mut v = vec![Line::from("")];

            if pass {
                v.push(Line::from(vec![
                    Span::styled("  ✓ ", Style::default().fg(colors::green())),
                    Span::styled("校验通过", Style::default().fg(colors::green()).add_modifier(Modifier::BOLD)),
                    Span::styled(
                        format!("    {} 表 · {} 文件 · {}ms", s.tables_loaded, s.files_loaded, s.duration_ms),
                        Style::default().fg(colors::muted()),
                    ),
                ]));
            } else {
                // 大号错误数 + 统计（同行紧凑）
                v.push(Line::from(vec![
                    Span::styled(format!("  {}", total), Style::default().fg(colors::red()).add_modifier(Modifier::BOLD)),
                    Span::styled(" 个错误", Style::default().fg(colors::red())),
                    Span::styled(
                        format!("    {} 表 · {} 文件 · {}ms", s.tables_loaded, s.files_loaded, s.duration_ms),
                        Style::default().fg(colors::muted()),
                    ),
                ]));

                // pass rate 进度条（紧接错误数，不空行）
                let pass_rate = resp.statistics.as_ref()
                    .map(|st| st.pass_rate / 100.0)
                    .unwrap_or(0.0);
                v.push(Line::from(vec![
                    Span::styled("  ", Style::default()),
                    Span::styled(icons::progress_bar(pass_rate), Style::default().fg(colors::cyan())),
                    Span::styled(format!(" {:.0}%", pass_rate * 100.0), Style::default().fg(colors::cyan())),
                    Span::styled(" pass rate", Style::default().fg(colors::dim())),
                ]));

                // 错误分布色块（紧接进度条，不空行）
                v.push(Line::from(vec![
                    Span::styled("  ■ ", Style::default().fg(colors::yellow())),
                    Span::styled(format!("格式 {}  ", s.format_error_count), Style::default().fg(colors::muted())),
                    Span::styled("■ ", Style::default().fg(colors::cyan())),
                    Span::styled(format!("约束 {}  ", s.constraint_error_count), Style::default().fg(colors::muted())),
                    Span::styled("■ ", Style::default().fg(colors::green())),
                    Span::styled(format!("加载 {}", s.loading_error_count), Style::default().fg(colors::muted())),
                ]));
            }
            v
        }
    };
    frame.render_widget(
        Paragraph::new(lines).style(Style::default().bg(colors::bg())),
        area,
    );
}

fn render_errors(frame: &mut Frame, app: &App, area: Rect) {
    match &app.validation {
        ValidationState::Done(resp) if !resp.errors.is_empty() => {
            // 动态列宽：按终端宽度分配
            let w = area.width as usize;
            let col_table = (w / 7).max(8);
            let col_col = (w / 7).max(8);
            let col_row = (w / 12).max(4);
            let col_type = (w / 5).max(8);
            let col_msg = w.saturating_sub(col_table + col_col + col_row + col_type + 8).max(10);

            let rows: Vec<Row> = resp
                .errors
                .iter()
                .take(500)
                .enumerate()
                .map(|(i, e)| {
                    let bg = if i % 2 == 0 { colors::bg() } else { colors::surface() };
                    Row::new(vec![
                        icons::truncate(&e.table, col_table),
                        icons::truncate(&e.column, col_col),
                        e.row_index.map(|r| r.to_string()).unwrap_or_default(),
                        icons::truncate(&e.error_type, col_type),
                        icons::truncate(&e.message, col_msg),
                    ])
                    .style(Style::default().bg(bg))
                })
                .collect();

            let header = Row::new(vec!["表", "字段", "行", "类型", "消息"])
                .style(Style::default().fg(colors::muted()).add_modifier(Modifier::BOLD))
                .bottom_margin(0);

            let table = Table::new(
                rows,
                [
                    Constraint::Length(col_table as u16),
                    Constraint::Length(col_col as u16),
                    Constraint::Length(col_row as u16),
                    Constraint::Length(col_type as u16),
                    Constraint::Min(10),
                ],
            )
            .header(header)
            .row_highlight_style(Style::default().bg(colors::panel()).fg(colors::pink()))
            .column_spacing(1)
            .style(Style::default().bg(colors::bg()));

            let mut state = TableState::default();
            let max_idx = resp.errors.len().saturating_sub(1).min(499);
            state.select(Some(app.error_cursor.min(max_idx)));
            frame.render_stateful_widget(table, area, &mut state);
        }
        _ => {}
    }
}
