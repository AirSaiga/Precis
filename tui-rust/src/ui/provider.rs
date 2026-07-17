//! Provider 页 — 着色表格 + 激活徽标 + 测试结果 toast

use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Cell, Paragraph, Row, Table, TableState};
use ratatui::Frame;

use super::widgets;
use crate::app::{colors, layout, App, TestResult};
use crate::icons;

pub fn render(frame: &mut Frame, app: &mut App, area: Rect) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(layout::PROVIDER_HINT),
            Constraint::Min(1),
            Constraint::Length(layout::PROVIDER_FOOTER),
        ])
        .split(area);

    // 提示行
    let hint = widgets::chips_line(&[("j/k", "导航"), ("t", "测试"), ("a", "激活"), ("r", "刷新")]);
    frame.render_widget(Paragraph::new(vec![Line::from(""), hint]), chunks[0]);

    if app.providers.is_empty() {
        frame.render_widget(
            Paragraph::new(vec![
                Line::from(""),
                Line::from(Span::styled("  未配置 Provider", Style::default().fg(colors::muted()))),
                Line::from(Span::styled(
                    "  在后端配置 ~/.precis/ai_providers.yaml",
                    Style::default().fg(colors::dim()),
                )),
            ]),
            chunks[1],
        );
    } else {
        render_table(frame, app, chunks[1]);
    }

    // 测试结果 toast（固定底部 3 行区域）
    let toast_lines = match &app.provider_test_result {
        Some(TestResult::Ok(info)) => {
            // main.rs 目前只回传 "ok"；将来若带回延迟等信息则附加显示
            let detail = if info == "ok" { String::new() } else { format!(" ({})", info) };
            vec![
                Line::from(""),
                Line::from(vec![
                    Span::styled(" ✓ ", Style::default().fg(colors::green())),
                    Span::styled(format!("连接正常{}", detail), Style::default().fg(colors::green())),
                ])
                .style(Style::default().bg(colors::surface())),
            ]
        }
        Some(TestResult::Fail(err)) => vec![
            Line::from(""),
            Line::from(vec![
                Span::styled(" ✗ ", Style::default().fg(colors::red())),
                Span::styled(icons::truncate(err, 60), Style::default().fg(colors::red())),
            ])
            .style(Style::default().bg(colors::surface())),
        ],
        None => vec![],
    };
    frame.render_widget(Paragraph::new(toast_lines), chunks[2]);
}

fn render_table(frame: &mut Frame, app: &App, area: Rect) {
    let active_id = app.active_provider_id.as_deref().unwrap_or("");

    let header = Row::new(vec!["", "", "名称", "类型", "模型", "端点"])
        .style(Style::default().fg(colors::dim()).add_modifier(Modifier::BOLD))
        .bottom_margin(0);

    let rows: Vec<Row> = app
        .providers
        .iter()
        .enumerate()
        .map(|(i, p)| {
            let is_active = p.id == active_id;
            let selected = i == app.provider_cursor;
            let zebra = if i % 2 == 0 { colors::bg() } else { colors::surface() };
            let row_bg = if selected { colors::panel() } else { zebra };
            let name_style = if is_active || selected {
                Style::default().fg(colors::fg()).add_modifier(Modifier::BOLD)
            } else {
                Style::default().fg(colors::muted())
            };

            // 名称格：名称 + 激活徽标（13 + 空格 + [已激活](10) ≤ 列宽 24）
            let mut name_spans = vec![Span::styled(icons::truncate(&p.name, 13), name_style)];
            if is_active {
                name_spans.push(Span::raw(" "));
                name_spans.extend(widgets::badge("已激活", colors::green()));
            }

            Row::new(vec![
                Cell::from(if selected { icons::BAR } else { " " })
                    .style(Style::default().fg(colors::gradient_a())),
                Cell::from(if is_active { "●" } else { "" })
                    .style(Style::default().fg(colors::green())),
                Cell::from(Line::from(name_spans)),
                Cell::from(p.provider_type.clone()),
                Cell::from(icons::truncate(&p.model, 20)),
                Cell::from(icons::truncate(&p.base_url, 30)),
            ])
            .style(Style::default().bg(row_bg).fg(colors::muted()))
        })
        .collect();

    let table = Table::new(
        rows,
        [
            Constraint::Length(1),
            Constraint::Length(1),
            Constraint::Length(24),
            Constraint::Length(10),
            Constraint::Length(22),
            Constraint::Min(10),
        ],
    )
    .header(header)
    .column_spacing(1)
    .style(Style::default().bg(colors::bg()));

    let mut state = TableState::default();
    state.select(Some(app.provider_cursor));
    frame.render_stateful_widget(table, area, &mut state);
}
