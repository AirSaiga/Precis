//! 校验页 — 大号数字摘要 + 无边框极简表格（Linear 风格）

use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Modifier, Style, Stylize};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Paragraph, Row, Table, TableState};
use ratatui::Frame;

use crate::app::{colors, App, ValidationState};

pub fn render(frame: &mut Frame, app: &mut App, area: Rect) {
    // 顶部留白
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(2), Constraint::Length(6), Constraint::Min(1)])
        .split(area);

    // 提示行
    let hint: String = match &app.validation {
        ValidationState::Idle => "  按 v 执行校验".to_string(),
        ValidationState::Validating => {
            let s = match app.frame_count % 6 { 0 => "⠋", 1 => "⠙", 2 => "⠹", 3 => "⠸", 4 => "⠼", _ => "⠴" };
            format!("  {} 校验中...", s)
        }
        ValidationState::Done(_) => "  校验完成  j/k 浏览  v 重新校验".to_string(),
        ValidationState::Failed(_) => "  校验失败  按 v 重试".to_string(),
    };
    frame.render_widget(
        Paragraph::new(hint).style(Style::default().fg(colors::MUTED)),
        chunks[0],
    );

    // 摘要区（大号数字，无边框，大留白）
    render_summary(frame, app, chunks[1]);

    // 错误表格（无边框，仅斑马纹）
    render_errors(frame, app, chunks[2]);
}

fn render_summary(frame: &mut Frame, app: &App, area: Rect) {
    let lines = match &app.validation {
        ValidationState::Idle => vec![
            Line::from(""),
            Line::from(Span::styled("  尚未校验", Style::default().fg(colors::DIM))),
        ],
        ValidationState::Validating => vec![
            Line::from(""),
            Line::from(Span::styled("  · · ·", Style::default().fg(colors::MUTED))),
        ],
        ValidationState::Failed(err) => {
            let msg = truncate(err, 60);
            vec![
                Line::from(""),
                Line::from(vec![
                    Span::styled("  ✗ ", Style::default().fg(colors::RED)),
                    Span::styled("校验失败", Style::default().fg(colors::RED).add_modifier(Modifier::BOLD)),
                ]),
                Line::from(Span::styled(format!("  {}", msg), Style::default().fg(colors::MUTED))),
            ]
        }
        ValidationState::Done(resp) => {
            let s = &resp.summary;
            let total = s.total_error_count;
            let pass = total == 0;
            let color = if pass { colors::GREEN } else { colors::PRIMARY };

            let mut v = vec![Line::from("")];

            if pass {
                v.push(Line::from(vec![
                    Span::styled("  ✓ ", Style::default().fg(colors::GREEN)),
                    Span::styled("校验通过", Style::default().fg(colors::GREEN).add_modifier(Modifier::BOLD)),
                ]));
                v.push(Line::from(Span::styled(
                    format!("  {} 表 · {} 文件 · {}ms", s.tables_loaded, s.files_loaded, s.duration_ms),
                    Style::default().fg(colors::MUTED),
                )));
            } else {
                v.push(Line::from(vec![
                    Span::styled(format!("  {}", total), Style::default().fg(color).add_modifier(Modifier::BOLD)),
                    Span::styled(" 个错误", Style::default().fg(colors::FG)),
                ]));
                v.push(Line::from(Span::styled(
                    format!("  {} 表 · {} 文件 · {}ms", s.tables_loaded, s.files_loaded, s.duration_ms),
                    Style::default().fg(colors::MUTED),
                )));
                v.push(Line::from(""));
                v.push(Line::from(vec![
                    Span::styled("  格式 ", Style::default().fg(colors::DIM)),
                    Span::styled(format!("{}", s.format_error_count), Style::default().fg(colors::YELLOW)),
                    Span::styled("  约束 ", Style::default().fg(colors::DIM)),
                    Span::styled(format!("{}", s.constraint_error_count), Style::default().fg(colors::YELLOW)),
                    Span::styled("  加载 ", Style::default().fg(colors::DIM)),
                    Span::styled(format!("{}", s.loading_error_count), Style::default().fg(colors::YELLOW)),
                ]));
            }
            v
        }
    };
    frame.render_widget(
        Paragraph::new(lines).style(Style::default().bg(colors::BG)),
        area,
    );
}

fn render_errors(frame: &mut Frame, app: &App, area: Rect) {
    match &app.validation {
        ValidationState::Done(resp) if !resp.errors.is_empty() => {
            let rows: Vec<Row> = resp
                .errors
                .iter()
                .take(500)
                .enumerate()
                .map(|(i, e)| {
                    let bg = if i % 2 == 0 { colors::BG } else { colors::SURFACE };
                    Row::new(vec![
                        truncate(&e.table, 18),
                        truncate(&e.column, 18),
                        e.row_index.map(|r| r.to_string()).unwrap_or_default(),
                        truncate(&e.error_type, 16),
                        truncate(&e.message, (area.width as usize) / 3),
                    ])
                    .style(Style::default().bg(bg))
                })
                .collect();

            let header = Row::new(vec!["表", "字段", "行", "类型", "消息"])
                .style(Style::default().fg(colors::MUTED).add_modifier(Modifier::BOLD))
                .bottom_margin(0);

            let table = Table::new(
                rows,
                [Constraint::Length(20), Constraint::Length(20), Constraint::Length(6), Constraint::Length(18), Constraint::Min(10)],
            )
            .header(header)
            .row_highlight_style(Style::default().bg(colors::PANEL).fg(colors::PRIMARY))
            .style(Style::default().bg(colors::BG));

            let mut state = TableState::default();
            let max_idx = resp.errors.len().saturating_sub(1).min(499);
            state.select(Some(app.error_cursor.min(max_idx)));
            frame.render_stateful_widget(table, area, &mut state);
        }
        _ => {}
    }
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let t: String = s.chars().take(max.saturating_sub(1)).collect();
        format!("{}…", t)
    }
}
