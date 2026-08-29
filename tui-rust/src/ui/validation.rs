//! 校验页 — 状态徽章 + 渐变通过率条 + 错误分布 + 着色错误表格

use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Cell, Paragraph, Row, Table, TableState};
use ratatui::Frame;

use super::widgets;
use crate::app::{colors, layout, App, ValidationState};
use crate::i18n::pick;
use crate::icons;

/// 错误表最多渲染条数（超出时在底部提示截断）
const MAX_ERRORS: usize = 500;

pub fn render(frame: &mut Frame, app: &mut App, area: Rect) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(layout::VALIDATION_HINT),
            Constraint::Length(layout::VALIDATION_SUMMARY),
            Constraint::Min(1),
        ])
        .split(area);

    // 提示行（按状态切换 chips / spinner）
    let hint = match &app.validation {
        ValidationState::Idle => widgets::chips_line(&[("v", pick("执行校验", "Validate"))]),
        ValidationState::Validating => Line::from(vec![
            Span::raw(" "),
            Span::styled(
                icons::spinner(app.frame_count),
                Style::default().fg(colors::gradient_a()),
            ),
            Span::styled(
                format!(" {}", pick("校验中...", "Validating...")),
                Style::default().fg(colors::muted()),
            ),
        ]),
        ValidationState::Done(_) => widgets::chips_line(&[
            ("j/k", pick("浏览", "Browse")),
            ("v", pick("重新校验", "Re-validate")),
        ]),
        ValidationState::Failed(_) => widgets::chips_line(&[("v", pick("重试", "Retry"))]),
    };
    frame.render_widget(Paragraph::new(vec![Line::from(""), hint]), chunks[0]);

    render_summary(frame, app, chunks[1]);
    render_errors(frame, app, chunks[2]);
}

fn render_summary(frame: &mut Frame, app: &App, area: Rect) {
    let lines = match &app.validation {
        ValidationState::Idle => vec![
            Line::from(""),
            Line::from(Span::styled(
                format!("  {}", pick("尚未校验", "Not validated yet")),
                Style::default().fg(colors::dim()),
            )),
        ],
        ValidationState::Validating => vec![
            Line::from(""),
            Line::from(Span::styled(
                format!(
                    "  {}",
                    pick(
                        "正在执行全量校验，请稍候",
                        "Running full validation, please wait"
                    )
                ),
                Style::default().fg(colors::dim()),
            )),
        ],
        ValidationState::Failed(err) => {
            let mut v = vec![
                Line::from(""),
                Line::from({
                    let mut spans = vec![Span::raw("  ")];
                    spans.extend(widgets::badge(
                        &format!("✗ {}", pick("校验失败", "Validation failed")),
                        colors::red(),
                    ));
                    spans
                }),
            ];
            for line in err.lines().take(4) {
                let truncated = icons::truncate(line.trim(), 80);
                v.push(Line::from(Span::styled(
                    format!("  {}", truncated),
                    Style::default().fg(colors::muted()),
                )));
            }
            v
        }
        ValidationState::Done(resp) => {
            let s = &resp.summary;
            let total = s.total_error_count;
            let pass = total == 0;

            let mut v = vec![Line::from("")];

            // C6 遇错即停：中断时在结果顶部提示（区别于正常完成）
            if s.interrupted {
                v.push(Line::from(vec![
                    Span::raw("  "),
                    Span::styled("! ", Style::default().fg(colors::yellow())),
                    Span::styled(
                        pick("校验已停止（遇错即停）", "Validation stopped (fail-fast)"),
                        Style::default()
                            .fg(colors::yellow())
                            .add_modifier(Modifier::BOLD),
                    ),
                    Span::styled(
                        pick(
                            "  发现首个错误即停止，剩余检查未执行",
                            "  Stopped at the first error; remaining checks were not run",
                        ),
                        Style::default().fg(colors::dim()),
                    ),
                ]));
            }

            let stats = format!(
                "  {} {} · {} {} · {}ms",
                s.tables_loaded,
                pick("表", "tables"),
                s.files_loaded,
                pick("文件", "files"),
                s.duration_ms
            );
            if pass {
                v.push(Line::from({
                    let mut spans = vec![Span::raw("  ")];
                    spans.extend(widgets::badge(
                        &format!("✓ {}", pick("校验通过", "Validation passed")),
                        colors::green(),
                    ));
                    spans.push(Span::styled(stats, Style::default().fg(colors::muted())));
                    spans
                }));
            } else {
                // 错误数徽章 + 统计
                v.push(Line::from({
                    let mut spans = vec![Span::raw("  ")];
                    spans.extend(widgets::badge(
                        &format!("✗ {} {}", total, pick("个错误", "errors")),
                        colors::red(),
                    ));
                    spans.push(Span::styled(stats, Style::default().fg(colors::muted())));
                    spans
                }));

                // 渐变通过率条
                let pass_rate = resp
                    .statistics
                    .as_ref()
                    .map(|st| st.pass_rate / 100.0)
                    .unwrap_or(0.0);
                let mut meter_line = vec![Span::raw("  ")];
                meter_line.extend(widgets::meter(pass_rate, 16));
                meter_line.push(Span::styled(
                    format!(" {:.0}%", pass_rate * 100.0),
                    Style::default().fg(colors::gradient_a()),
                ));
                meter_line.push(Span::styled(
                    " pass rate",
                    Style::default().fg(colors::dim()),
                ));
                v.push(Line::from(meter_line));

                // 错误分布
                v.push(Line::from(vec![
                    Span::styled("  ■ ", Style::default().fg(colors::yellow())),
                    Span::styled(
                        format!("{} {}  ", pick("格式", "Format"), s.format_error_count),
                        Style::default().fg(colors::muted()),
                    ),
                    Span::styled("■ ", Style::default().fg(colors::cyan())),
                    Span::styled(
                        format!(
                            "{} {}  ",
                            pick("约束", "Constraint"),
                            s.constraint_error_count
                        ),
                        Style::default().fg(colors::muted()),
                    ),
                    Span::styled("■ ", Style::default().fg(colors::green())),
                    Span::styled(
                        format!("{} {}", pick("加载", "Load"), s.loading_error_count),
                        Style::default().fg(colors::muted()),
                    ),
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
    let ValidationState::Done(resp) = &app.validation else {
        return;
    };
    if resp.errors.is_empty() {
        return;
    }

    // 动态列宽：按终端宽度分配（首列为选中条 ▌）
    let w = area.width as usize;
    let col_table = (w / 7).max(8);
    let col_col = (w / 7).max(8);
    let col_row = (w / 12).max(4);
    let col_type = (w / 5).max(8);
    let col_msg = w
        .saturating_sub(col_table + col_col + col_row + col_type + 10)
        .max(10);

    let cursor = app
        .error_cursor
        .min(resp.errors.len().saturating_sub(1).min(MAX_ERRORS - 1));

    let rows: Vec<Row> = resp
        .errors
        .iter()
        .take(MAX_ERRORS)
        .enumerate()
        .map(|(i, e)| {
            let selected = i == cursor;
            let zebra = if i % 2 == 0 {
                colors::bg()
            } else {
                colors::surface()
            };
            let row_bg = if selected { colors::panel() } else { zebra };
            let text_fg = if selected {
                colors::fg()
            } else {
                colors::muted()
            };
            // 类型列按校验阶段着色
            let type_color = match e.stage.as_str() {
                "loading" => colors::green(),
                "format" => colors::yellow(),
                _ => colors::cyan(),
            };
            Row::new(vec![
                Cell::from(if selected { icons::BAR } else { " " })
                    .style(Style::default().fg(colors::gradient_a())),
                Cell::from(icons::truncate(&e.table, col_table)),
                Cell::from(icons::truncate(&e.column, col_col)),
                Cell::from(e.row_index.map(|r| r.to_string()).unwrap_or_default()),
                Cell::from(icons::truncate(&e.error_type, col_type))
                    .style(Style::default().fg(type_color)),
                Cell::from(icons::truncate(&e.message, col_msg)),
            ])
            .style(Style::default().bg(row_bg).fg(text_fg))
        })
        .collect();

    let header = Row::new(vec![
        "",
        pick("表", "Table"),
        pick("字段", "Column"),
        pick("行", "Row"),
        pick("类型", "Type"),
        pick("消息", "Message"),
    ])
    .style(
        Style::default()
            .fg(colors::dim())
            .add_modifier(Modifier::BOLD),
    )
    .bottom_margin(0);

    let table = Table::new(
        rows,
        [
            Constraint::Length(1),
            Constraint::Length(col_table as u16),
            Constraint::Length(col_col as u16),
            Constraint::Length(col_row as u16),
            Constraint::Length(col_type as u16),
            Constraint::Min(10),
        ],
    )
    .header(header)
    .column_spacing(1)
    .style(Style::default().bg(colors::bg()));

    // 超过渲染上限时表格让出最底 1 行，提示用户列表不完整（否则静默截断无从得知）
    let truncated = resp.errors.len() > MAX_ERRORS && area.height >= 2;
    let table_area = if truncated {
        Rect {
            height: area.height - 1,
            ..area
        }
    } else {
        area
    };

    let mut state = TableState::default();
    state.select(Some(cursor));
    frame.render_stateful_widget(table, table_area, &mut state);

    if truncated {
        let hint = Line::from(Span::styled(
            format!(
                "  … {} {} {} {} {}",
                pick("仅显示前", "Showing first"),
                MAX_ERRORS,
                pick("条 · 共", "of"),
                resp.errors.len(),
                pick("条错误", "errors")
            ),
            Style::default().fg(colors::dim()),
        ));
        frame.render_widget(
            Paragraph::new(hint),
            Rect {
                y: area.y + area.height - 1,
                height: 1,
                ..area
            },
        );
    }
}
