//! 配置页 — Schema/约束列表概览

use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Modifier, Style, Stylize};
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;
use ratatui::Frame;

use crate::app::{colors, App};

pub fn render(frame: &mut Frame, app: &mut App, area: Rect) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(2), Constraint::Min(1)])
        .split(area);

    // 提示
    frame.render_widget(
        Paragraph::new("  配置概览  r 刷新")
            .style(Style::default().fg(colors::MUTED)),
        chunks[0],
    );

    match &app.config_data {
        None => {
            frame.render_widget(
                Paragraph::new("\n\n  按 r 加载配置")
                    .style(Style::default().fg(colors::DIM)),
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
                        Span::styled("  项目  ", Style::default().fg(colors::DIM)),
                        Span::styled(name, Style::default().fg(colors::FG).add_modifier(Modifier::BOLD)),
                        Span::styled(format!("  ({})", id), Style::default().fg(colors::MUTED)),
                    ]));
                }

                // Schemas
                if let Some(schemas) = manifest.get("schemas").and_then(|v| v.as_array()) {
                    lines.push(Line::from(""));
                    lines.push(Line::from(vec![
                        Span::styled(format!("  {} ", schemas.len()), Style::default().fg(colors::PINK).add_modifier(Modifier::BOLD)),
                        Span::styled("个 Schema", Style::default().fg(colors::MUTED)),
                    ]));
                    for s in schemas.iter().take(10) {
                        let sid = s.get("id").and_then(|v| v.as_str()).unwrap_or("?");
                        let spath = s.get("path").and_then(|v| v.as_str()).unwrap_or("");
                        lines.push(Line::from(vec![
                            Span::styled("    · ", Style::default().fg(colors::DIM)),
                            Span::styled(sid.to_string(), Style::default().fg(colors::FG)),
                            Span::styled(format!("  {}", spath), Style::default().fg(colors::DIM)),
                        ]));
                    }
                    if schemas.len() > 10 {
                        lines.push(Line::from(Span::styled(
                            format!("    ... 还有 {} 个", schemas.len() - 10),
                            Style::default().fg(colors::DIM),
                        )));
                    }
                }

                // Constraints
                if let Some(constraints) = manifest.get("constraints").and_then(|v| v.as_array()) {
                    lines.push(Line::from(""));
                    lines.push(Line::from(vec![
                        Span::styled(format!("  {} ", constraints.len()), Style::default().fg(colors::PINK).add_modifier(Modifier::BOLD)),
                        Span::styled("个约束", Style::default().fg(colors::MUTED)),
                    ]));
                }
            }

            // 覆盖率
            if let Some(ref coverage) = config.coverage {
                if let Some(obj) = coverage.as_object() {
                    lines.push(Line::from(""));
                    lines.push(Line::from(Span::styled("  覆盖率", Style::default().fg(colors::DIM))));
                    for (key, val) in obj.iter().take(5) {
                        lines.push(Line::from(vec![
                            Span::styled(format!("    {} ", key), Style::default().fg(colors::MUTED)),
                            Span::styled(val.to_string(), Style::default().fg(colors::FG)),
                        ]));
                    }
                }
            }

            frame.render_widget(
                Paragraph::new(lines).style(Style::default().bg(colors::BG)),
                chunks[1],
            );
        }
    }
}
