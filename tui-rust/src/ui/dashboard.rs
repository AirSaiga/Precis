//! 首页 — 留白为主，居中状态卡 + 项目列表（Linear 风格）

use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Modifier, Style, Stylize};
use ratatui::text::{Line, Span};
use ratatui::widgets::{List, ListItem, ListState, Paragraph};
use ratatui::Frame;

use crate::app::{colors, layout, App};

pub fn render(frame: &mut Frame, app: &mut App, area: Rect) {
    // 动态分割：状态区(固定) + 项目列表(填充)
    let chunks = Layout::default()
        .direction(ratatui::layout::Direction::Vertical)
        .constraints([
            Constraint::Length(layout::DASHBOARD_HEADER),
            Constraint::Min(1),
        ])
        .split(area);

    let mut lines: Vec<Line> = Vec::new();
    lines.push(Line::from(""));
    lines.push(Line::from(""));

    if app.project_name.is_some() {
        let name = app.project_name.as_deref().unwrap_or("");
        lines.push(Line::from(vec![
            Span::styled("  ● ", Style::default().fg(colors::green())),
            Span::styled(name, Style::default().fg(colors::fg()).add_modifier(Modifier::BOLD)),
        ]));
        if let Some(p) = app.projects.get(app.selected_project) {
            lines.push(Line::from(Span::styled(format!("  {}", p.path), Style::default().fg(colors::dim()))));
        }
    } else {
        lines.push(Line::from(vec![
            Span::styled("  Precis", Style::default().fg(colors::dim()).add_modifier(Modifier::BOLD)),
            Span::styled("  本地数据校验工具", Style::default().fg(colors::dim())),
        ]));
    }

    lines.push(Line::from(""));
    lines.push(Line::from(Span::styled(
        format!("  项目 ({})  j/k 选择  Enter 打开", app.projects.len()),
        Style::default().fg(colors::muted()),
    )));

    let header = Paragraph::new(lines).style(Style::default().bg(colors::bg()));
    frame.render_widget(header, chunks[0]);

    let list_area = chunks[1];

    if app.projects.is_empty() {
        let empty = Paragraph::new("\n\n  未找到项目\n\n  确保后端正在运行 (npm run backend:dev)\n  且扫描目录下有 project.precis.yaml")
            .style(Style::default().fg(colors::dim()));
        frame.render_widget(empty, list_area);
        return;
    }

    let current_path = app.api.project_path().unwrap_or("").to_string();
    let items: Vec<ListItem> = app
        .projects
        .iter()
        .enumerate()
        .map(|(idx, p)| {
            let is_current = p.path == current_path;
            let is_selected = idx == app.selected_project;
            let marker_color = if is_current { colors::green() } else { colors::dim() };
            let name_style = if is_current {
                Style::default().fg(colors::fg()).add_modifier(Modifier::BOLD)
            } else {
                Style::default().fg(colors::fg())
            };
            let prefix = if is_selected { "▸" } else { " " };
            ListItem::new(vec![
                Line::from(vec![
                    Span::styled(format!(" {}{} ", prefix, if is_current { "●" } else { " " }), Style::default().fg(if is_selected { colors::pink() } else { marker_color })),
                    Span::styled(&p.name, name_style),
                    Span::styled(
                        format!("   {} schema · {} 约束", p.schema_count.unwrap_or(0), p.constraint_count.unwrap_or(0)),
                        Style::default().fg(colors::dim()),
                    ),
                ]),
                Line::from(Span::styled(format!("    {}", p.path), Style::default().fg(colors::dim()))),
            ])
        })
        .collect();

    let list = List::new(items)
        .style(Style::default().bg(colors::bg()))
        .highlight_style(Style::default().bg(colors::panel()))
        .highlight_symbol("");

    let mut state = ListState::default();
    state.select(Some(app.selected_project));
    frame.render_stateful_widget(list, list_area, &mut state);
}
