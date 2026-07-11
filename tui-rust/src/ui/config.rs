//! 配置页 — Schema/约束列表概览

use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Modifier, Style, Stylize};
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;
use ratatui::Frame;

use crate::app::{colors, layout, App};
use crate::icons;

pub fn render(frame: &mut Frame, app: &mut App, area: Rect) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(layout::CONFIG_HINT),
            Constraint::Min(1),
        ])
        .split(area);

    // 提示
    frame.render_widget(
        Paragraph::new("  配置概览  r 刷新")
            .style(Style::default().fg(colors::muted())),
        chunks[0],
    );

    match &app.config_data {
        None => {
            frame.render_widget(
                Paragraph::new("\n\n  按 r 加载配置")
                    .style(Style::default().fg(colors::dim())),
                chunks[1],
            );
        }
        Some(config) => {
            let mut lines: Vec<Line> = Vec::new();
            lines.push(Line::from(""));

            // 项目信息
            if let Some(manifest) = config.manifest.as_object() {
                if let Some(project) = manifest.get("project").and_then(|v| v.as_object()) {
                    let name = project.get("name").and_then(|v| v.as_str()).unwrap_or("未知");
                    let id = project.get("id").and_then(|v| v.as_str()).unwrap_or("");
                    lines.push(Line::from(vec![
                        Span::styled("  项目  ", Style::default().fg(colors::dim())),
                        Span::styled(name, Style::default().fg(colors::fg()).add_modifier(Modifier::BOLD)),
                        Span::styled(format!("  ({})", id), Style::default().fg(colors::muted())),
                    ]));
                }

                // Schemas
                if let Some(schemas) = manifest.get("schemas").and_then(|v| v.as_array()) {
                    lines.push(Line::from(""));
                    lines.push(Line::from(vec![
                        Span::styled(format!("  {} ", schemas.len()), Style::default().fg(colors::pink()).add_modifier(Modifier::BOLD)),
                        Span::styled("个 Schema", Style::default().fg(colors::muted())),
                    ]));
                    for s in schemas.iter().take(10) {
                        let sid = s.get("id").and_then(|v| v.as_str()).unwrap_or("?");
                        let spath = s.get("path").and_then(|v| v.as_str()).unwrap_or("");
                        lines.push(Line::from(vec![
                            Span::styled("    · ", Style::default().fg(colors::dim())),
                            Span::styled(sid.to_string(), Style::default().fg(colors::fg())),
                            Span::styled(format!("  {}", spath), Style::default().fg(colors::dim())),
                        ]));
                    }
                    if schemas.len() > 10 {
                        lines.push(Line::from(Span::styled(
                            format!("    ... 还有 {} 个", schemas.len() - 10),
                            Style::default().fg(colors::dim()),
                        )));
                    }
                }

                // Constraints
                if let Some(constraints) = manifest.get("constraints").and_then(|v| v.as_array()) {
                    lines.push(Line::from(""));
                    lines.push(Line::from(vec![
                        Span::styled(format!("  {} ", constraints.len()), Style::default().fg(colors::pink()).add_modifier(Modifier::BOLD)),
                        Span::styled("个约束", Style::default().fg(colors::muted())),
                    ]));
                }
            }

            // 覆盖率
            if let Some(ref coverage) = config.coverage {
                if let Some(obj) = coverage.as_object() {
                    lines.push(Line::from(""));
                    lines.push(Line::from(Span::styled("  覆盖率", Style::default().fg(colors::dim()))));
                    for (key, val) in obj.iter().take(5) {
                        // 尝试提取数值百分比
                        let pct = val.as_f64().or_else(|| {
                            val.as_str().and_then(|s| s.trim_end_matches('%').parse::<f64>().ok())
                        });
                        let (bar_color, pct_text) = if let Some(p) = pct {
                            let color = if p >= 60.0 {
                                colors::green()
                            } else if p >= 40.0 {
                                colors::cyan()
                            } else {
                                colors::yellow()
                            };
                            (color, format!("{:.0}%", p))
                        } else {
                            (colors::muted(), val.to_string())
                        };
                        let ratio = pct.map(|p| (p / 100.0).clamp(0.0, 1.0)).unwrap_or(0.0);
                        lines.push(Line::from(vec![
                            Span::styled(format!("    {:<10} ", key), Style::default().fg(colors::muted())),
                            Span::styled(icons::progress_bar(ratio), Style::default().fg(bar_color)),
                            Span::styled(format!(" {}", pct_text), Style::default().fg(bar_color)),
                        ]));
                    }
                }
            }

            frame.render_widget(
                Paragraph::new(lines).style(Style::default().bg(colors::bg())),
                chunks[1],
            );
        }
    }
}
