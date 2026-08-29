//! Provider 页 — 着色表格 + 激活徽标 + 测试结果 toast

use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Cell, Paragraph, Row, Table, TableState};
use ratatui::Frame;

use super::widgets;
use crate::app::{colors, layout, App, TestResult};
use crate::i18n::pick;
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
    let hint = widgets::chips_line(&[
        ("j/k", pick("导航", "Navigate")),
        ("t", pick("测试", "Test")),
        ("a", pick("激活", "Activate")),
        ("n", pick("新建", "New")),
        ("r", pick("刷新", "Refresh")),
    ]);
    frame.render_widget(Paragraph::new(vec![Line::from(""), hint]), chunks[0]);

    if app.providers.is_empty() {
        frame.render_widget(
            Paragraph::new(vec![
                Line::from(""),
                Line::from(Span::styled(
                    format!("  {}", pick("未配置 Provider", "No providers configured")),
                    Style::default().fg(colors::muted()),
                )),
                Line::from(Span::styled(
                    format!(
                        "  {}",
                        pick(
                            "按 n 新建，或编辑 ~/.precis/ai_providers.yaml",
                            "Press n to create one, or edit ~/.precis/ai_providers.yaml"
                        )
                    ),
                    Style::default().fg(colors::dim()),
                )),
            ]),
            chunks[1],
        );
    } else {
        render_table(frame, app, chunks[1]);
    }

    // 测试结果 toast（固定底部 3 行区域）— 绑定被测 provider：
    // 光标不在被测行（避免张冠李戴）或超时（约 5 秒 TTL）时均不渲染
    let mut toast_lines: Vec<Line> = Vec::new();
    if let Some(t) = &app.provider_test_result {
        let expired = app.frame_count.saturating_sub(t.at_frame) > 165; // ≈5 秒 @33fps
        let cursor_id = app
            .providers
            .get(app.provider_cursor)
            .map(|p| p.id.as_str());
        if !expired && cursor_id == Some(t.provider_id.as_str()) {
            toast_lines = match &t.result {
                TestResult::Ok(info) => {
                    // main.rs 目前只回传 "ok"；将来若带回延迟等信息则附加显示
                    let detail = if info == "ok" {
                        String::new()
                    } else {
                        format!(" ({})", info)
                    };
                    vec![
                        Line::from(""),
                        Line::from(vec![
                            Span::styled(" ✓ ", Style::default().fg(colors::green())),
                            Span::styled(
                                format!("{}{}", pick("连接正常", "Connection OK"), detail),
                                Style::default().fg(colors::green()),
                            ),
                        ])
                        .style(Style::default().bg(colors::surface())),
                    ]
                }
                TestResult::Fail(err) => vec![
                    Line::from(""),
                    Line::from(vec![
                        Span::styled(" ✗ ", Style::default().fg(colors::red())),
                        Span::styled(icons::truncate(err, 60), Style::default().fg(colors::red())),
                    ])
                    .style(Style::default().bg(colors::surface())),
                ],
            };
        }
    }
    frame.render_widget(Paragraph::new(toast_lines), chunks[2]);

    // 新建表单覆盖层（最后渲染，置于顶层）
    if app.provider_form.is_some() {
        render_form(frame, app, area);
    }
}

/// 新建 Provider 表单：居中模态面板
fn render_form(frame: &mut Frame, app: &App, area: Rect) {
    let Some(form) = &app.provider_form else {
        return;
    };

    let w = area.width.min(56);
    let h = 13u16.min(area.height);
    let rect = Rect {
        x: area.x + area.width.saturating_sub(w) / 2,
        y: area.y + area.height.saturating_sub(h) / 2,
        width: w,
        height: h,
    };
    frame.render_widget(ratatui::widgets::Clear, rect);
    let block = widgets::panel(pick("新建 Provider", "New Provider"), colors::green());
    let inner = block.inner(rect);
    frame.render_widget(block, rect);
    if inner.height < 8 {
        return;
    }

    // (标签, 显示值, 是否类型切换字段)
    let fields: [(&str, String, bool); 5] = [
        (pick("名称", "Name"), form.name.clone(), false),
        (pick("类型", "Type"), form.ptype.clone(), true),
        ("Base URL", form.base_url.clone(), false),
        ("API Key", "*".repeat(form.api_key.chars().count()), false),
        (pick("模型", "Model"), form.model.clone(), false),
    ];

    let mut lines: Vec<Line> = vec![Line::from("")];
    for (i, (label, value, is_toggle)) in fields.iter().enumerate() {
        let focused = form.field == i;
        let bar_color = if focused {
            colors::gradient_a()
        } else {
            colors::dim()
        };
        let mut spans = vec![
            Span::styled(
                if focused { icons::BAR } else { " " },
                Style::default().fg(bar_color),
            ),
            Span::styled(
                format!(" {} ", widgets::truncate_width(label, 8)),
                Style::default().fg(if focused {
                    colors::fg()
                } else {
                    colors::muted()
                }),
            ),
        ];
        if *is_toggle {
            spans.push(Span::styled(
                format!("‹ {} ›", value),
                Style::default()
                    .fg(colors::green())
                    .add_modifier(Modifier::BOLD),
            ));
            if focused {
                spans.push(Span::styled(
                    format!("  ←→ {}", pick("切换", "Toggle")),
                    Style::default().fg(colors::dim()),
                ));
            }
        } else {
            let value_style = if focused {
                Style::default()
                    .fg(colors::fg())
                    .add_modifier(Modifier::BOLD)
            } else {
                Style::default().fg(colors::fg())
            };
            spans.push(Span::styled(value.clone(), value_style));
            if focused {
                // 闪烁光标（复用 chat 输入框节奏）
                let cursor = if app.frame_count % 16 < 8 {
                    Style::default()
                        .fg(colors::gradient_a())
                        .add_modifier(Modifier::REVERSED)
                } else {
                    Style::default().fg(colors::fg())
                };
                spans.push(Span::styled(" ", cursor));
            }
        }
        lines.push(Line::from(spans));
    }

    lines.push(Line::from(""));
    lines.push(Line::from(vec![
        Span::styled("  Tab/↑↓ ", Style::default().fg(colors::gradient_a())),
        Span::styled(
            format!("{}  ", pick("切换字段", "Next field")),
            Style::default().fg(colors::dim()),
        ),
        Span::styled("Enter ", Style::default().fg(colors::gradient_a())),
        Span::styled(
            format!("{}  ", pick("提交", "Submit")),
            Style::default().fg(colors::dim()),
        ),
        Span::styled("Esc ", Style::default().fg(colors::gradient_a())),
        Span::styled(pick("取消", "Cancel"), Style::default().fg(colors::dim())),
    ]));
    frame.render_widget(
        Paragraph::new(lines).style(Style::default().bg(colors::bg())),
        inner,
    );
}

fn render_table(frame: &mut Frame, app: &App, area: Rect) {
    let active_id = app.active_provider_id.as_deref().unwrap_or("");

    let header = Row::new(vec![
        "",
        "",
        pick("名称", "Name"),
        pick("类型", "Type"),
        pick("模型", "Model"),
        pick("端点", "Endpoint"),
    ])
    .style(
        Style::default()
            .fg(colors::dim())
            .add_modifier(Modifier::BOLD),
    )
    .bottom_margin(0);

    let rows: Vec<Row> = app
        .providers
        .iter()
        .enumerate()
        .map(|(i, p)| {
            let is_active = p.id == active_id;
            let selected = i == app.provider_cursor;
            let zebra = if i % 2 == 0 {
                colors::bg()
            } else {
                colors::surface()
            };
            let row_bg = if selected { colors::panel() } else { zebra };
            let name_style = if is_active || selected {
                Style::default()
                    .fg(colors::fg())
                    .add_modifier(Modifier::BOLD)
            } else {
                Style::default().fg(colors::muted())
            };

            // 名称格：名称 + 激活徽标（13 + 空格 + [已激活](10) ≤ 列宽 24）
            let mut name_spans = vec![Span::styled(icons::truncate(&p.name, 13), name_style)];
            if is_active {
                name_spans.push(Span::raw(" "));
                name_spans.extend(widgets::badge(pick("已激活", "Active"), colors::green()));
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
