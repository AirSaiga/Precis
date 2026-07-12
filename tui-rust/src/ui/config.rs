//! 配置页 — Schema/约束概览 + 覆盖率进度条

use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Modifier, Style};
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
        Paragraph::new("  项目概览  r 刷新")
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

            // 项目信息
            if let Some(manifest) = config.manifest.as_object() {
                if let Some(project) = manifest.get("project").and_then(|v| v.as_object()) {
                    let name = project.get("name").and_then(|v| v.as_str()).unwrap_or("未知");
                    let id = project.get("id").and_then(|v| v.as_str()).unwrap_or("");
                    lines.push(Line::from(vec![
                        Span::styled("  ", Style::default()),
                        Span::styled(name, Style::default().fg(colors::fg()).add_modifier(Modifier::BOLD)),
                        Span::styled(format!("  ({})", id), Style::default().fg(colors::dim())),
                    ]));
                }

                // Schemas
                if let Some(schemas) = manifest.get("schemas").and_then(|v| v.as_array()) {
                    lines.push(Line::from(""));
                    lines.push(Line::from(vec![
                        Span::styled(format!("  {}", schemas.len()), Style::default().fg(colors::pink()).add_modifier(Modifier::BOLD)),
                        Span::styled(" Schema", Style::default().fg(colors::muted())),
                    ]));
                    for s in schemas.iter().take(8) {
                        let sid = s.get("id").and_then(|v| v.as_str()).unwrap_or("?");
                        let spath = s.get("path").and_then(|v| v.as_str()).unwrap_or("");
                        lines.push(Line::from(vec![
                            Span::styled("    \u{25e6} ", Style::default().fg(colors::cyan())),
                            Span::styled(icons::truncate(sid, 20), Style::default().fg(colors::fg())),
                            Span::styled(format!("  {}", icons::truncate(spath, 30)), Style::default().fg(colors::dim())),
                        ]));
                    }
                    if schemas.len() > 8 {
                        lines.push(Line::from(Span::styled(
                            format!("    ... {} more", schemas.len() - 8),
                            Style::default().fg(colors::dim()),
                        )));
                    }
                }

                // Constraints
                if let Some(constraints) = manifest.get("constraints").and_then(|v| v.as_array()) {
                    lines.push(Line::from(""));
                    lines.push(Line::from(vec![
                        Span::styled(format!("  {}", constraints.len()), Style::default().fg(colors::pink()).add_modifier(Modifier::BOLD)),
                        Span::styled(" \u{7ea6}\u{675f}", Style::default().fg(colors::muted())),
                    ]));
                }
            }

            // Coverage
            if let Some(ref coverage) = config.coverage {
                if let Some(obj) = coverage.as_object() {
                    lines.push(Line::from(""));
                    lines.push(Line::from(Span::styled("  \u{8986}\u{76d6}\u{7387}", Style::default().fg(colors::dim()))));
                    for (key, val) in obj.iter().take(6) {
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
                            Span::styled(format!("  {:<12} ", key), Style::default().fg(colors::muted())),
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
