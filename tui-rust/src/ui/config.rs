//! 概览页 — 双栏布局：项目信息 + Schema 清单 | 约束统计 + 覆盖率渐变条

use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;
use ratatui::Frame;

use super::widgets;
use crate::app::{colors, layout, App};
use crate::icons;

pub fn render(frame: &mut Frame, app: &mut App, area: Rect) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(layout::CONFIG_HINT), Constraint::Min(1)])
        .split(area);

    // 提示行
    let hint = widgets::chips_line(&[("r", "刷新")]);
    frame.render_widget(Paragraph::new(vec![Line::from(""), hint]), chunks[0]);

    let Some(config) = &app.config_data else {
        frame.render_widget(
            Paragraph::new(vec![
                Line::from(""),
                Line::from(Span::styled(
                    "  按 r 加载配置（需先在首页打开项目）",
                    Style::default().fg(colors::dim()),
                )),
            ]),
            chunks[1],
        );
        return;
    };

    // — 左栏：项目信息 + Schema 清单 + 约束计数 —
    let mut left: Vec<Line> = Vec::new();
    if let Some(manifest) = config.manifest.as_object() {
        if let Some(project) = manifest.get("project").and_then(|v| v.as_object()) {
            let name = project.get("name").and_then(|v| v.as_str()).unwrap_or("未知");
            let id = project.get("id").and_then(|v| v.as_str()).unwrap_or("");
            left.push(Line::from(vec![
                Span::raw(" "),
                Span::styled(
                    name.to_string(),
                    Style::default().fg(colors::fg()).add_modifier(Modifier::BOLD),
                ),
                Span::styled(format!("  ({})", id), Style::default().fg(colors::dim())),
            ]));
        }

        if let Some(schemas) = manifest.get("schemas").and_then(|v| v.as_array()) {
            left.push(Line::from(""));
            left.push(widgets::section_header("◇", "Schema", Some(schemas.len()), 24));
            for s in schemas.iter().take(8) {
                let sid = s.get("id").and_then(|v| v.as_str()).unwrap_or("?");
                let spath = s.get("path").and_then(|v| v.as_str()).unwrap_or("");
                left.push(Line::from(vec![
                    Span::styled("  ◦ ", Style::default().fg(colors::cyan())),
                    Span::styled(icons::truncate(sid, 16), Style::default().fg(colors::fg())),
                    Span::styled(
                        format!("  {}", icons::truncate(spath, 24)),
                        Style::default().fg(colors::dim()),
                    ),
                ]));
            }
            if schemas.len() > 8 {
                left.push(Line::from(Span::styled(
                    format!("    ... 共 {} 个", schemas.len()),
                    Style::default().fg(colors::dim()),
                )));
            }
        }

        if let Some(constraints) = manifest.get("constraints").and_then(|v| v.as_array()) {
            left.push(Line::from(""));
            left.push(widgets::section_header("◆", "约束", Some(constraints.len()), 24));
        }
    }

    // — 右栏：覆盖率渐变条组 —
    let mut right: Vec<Line> = Vec::new();
    match &config.coverage {
        Some(coverage) if coverage.as_object().is_some_and(|o| !o.is_empty()) => {
            let obj = coverage.as_object().unwrap();
            right.push(widgets::section_header("◉", "覆盖率", None, 24));
            right.push(Line::from(""));
            for (key, val) in obj.iter().take(8) {
                let pct = val.as_f64().or_else(|| {
                    val.as_str().and_then(|s| s.trim_end_matches('%').parse::<f64>().ok())
                });
                let (bar_color, pct_text, ratio) = if let Some(p) = pct {
                    let color = if p >= 60.0 {
                        colors::green()
                    } else if p >= 40.0 {
                        colors::cyan()
                    } else {
                        colors::yellow()
                    };
                    (color, format!("{:.0}%", p), (p / 100.0).clamp(0.0, 1.0))
                } else {
                    (colors::muted(), val.to_string(), 0.0)
                };
                let mut spans = vec![Span::styled(
                    format!("  {} ", widgets::truncate_width(key, 12)),
                    Style::default().fg(colors::muted()),
                )];
                spans.extend(widgets::meter(ratio, 12));
                spans.push(Span::styled(format!(" {}", pct_text), Style::default().fg(bar_color)));
                right.push(Line::from(spans));
            }
        }
        _ => {
            right.push(widgets::section_header("◉", "覆盖率", None, 24));
            right.push(Line::from(""));
            right.push(Line::from(Span::styled(
                "  暂无覆盖率数据",
                Style::default().fg(colors::dim()),
            )));
        }
    }

    // 宽屏双栏、窄屏单栏纵排
    if area.width >= layout::CARD_ROW_MIN_WIDTH {
        let cols = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Ratio(1, 2), Constraint::Ratio(1, 2)])
            .split(chunks[1]);
        frame.render_widget(Paragraph::new(left).style(Style::default().bg(colors::bg())), cols[0]);
        frame.render_widget(
            Paragraph::new(right).style(Style::default().bg(colors::bg())),
            cols[1],
        );
    } else {
        left.push(Line::from(""));
        left.extend(right);
        frame.render_widget(
            Paragraph::new(left).style(Style::default().bg(colors::bg())),
            chunks[1],
        );
    }
}
