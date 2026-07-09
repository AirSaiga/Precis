//! 首页 — 留白为主，居中状态卡 + 项目列表（Linear 风格）

use ratatui::layout::{Alignment, Rect};
use ratatui::style::{Modifier, Style, Stylize};
use ratatui::text::{Line, Span};
use ratatui::widgets::{List, ListItem, ListState, Paragraph};
use ratatui::Frame;

use crate::app::{colors, App};

pub fn render(frame: &mut Frame, app: &mut App, area: Rect) {
    // 未打开项目：居中引导 + 项目列表
    // 已打开项目：上方状态卡 + 下方项目列表

    let mut lines: Vec<Line> = Vec::new();

    // 顶部留白
    lines.push(Line::from(""));
    lines.push(Line::from(""));

    if app.project_name.is_some() {
        // 已打开项目：状态卡
        let name = app.project_name.as_deref().unwrap_or("");
        lines.push(Line::from(vec![
            Span::styled("  ", Style::default()),
            Span::styled("● ", Style::default().fg(colors::GREEN)),
            Span::styled(name, Style::default().fg(colors::FG).add_modifier(Modifier::BOLD)),
        ]));

        if let Some(p) = app.projects.get(app.selected_project) {
            lines.push(Line::from(Span::styled(
                format!("  {}", p.path),
                Style::default().fg(colors::DIM),
            )));
        }
    } else {
        // 未打开：暗淡标题 + 引导
        lines.push(Line::from(vec![
            Span::styled("  ", Style::default()),
            Span::styled("Precis", Style::default().fg(colors::DIM).add_modifier(Modifier::BOLD)),
            Span::styled("  本地数据校验工具", Style::default().fg(colors::DIM)),
        ]));
    }

    lines.push(Line::from(""));
    lines.push(Line::from(Span::styled(
        format!("  项目 ({})  j/k 选择  Enter 打开", app.projects.len()),
        Style::default().fg(colors::MUTED),
    )));
    lines.push(Line::from(""));

    // 渲染状态区
    let header = Paragraph::new(lines).style(Style::default().bg(colors::BG));
    let header_height = 9;
    frame.render_widget(header, Rect { x: area.x, y: area.y, width: area.width, height: header_height.min(area.height) });

    // 项目列表区
    let list_area = Rect {
        x: area.x,
        y: area.y + header_height,
        width: area.width,
        height: area.height.saturating_sub(header_height),
    };

    if app.projects.is_empty() {
        let empty = Paragraph::new("\n\n  未找到项目\n\n  确保后端正在运行 (npm run backend:dev)\n  且扫描目录下有 project.precis.yaml")
            .style(Style::default().fg(colors::DIM));
        frame.render_widget(empty, list_area);
        return;
    }

    let current_path = app.api.project_path().unwrap_or("").to_string();
    let items: Vec<ListItem> = app
        .projects
        .iter()
        .map(|p| {
            let is_current = p.path == current_path;
            let marker_color = if is_current { colors::GREEN } else { colors::DIM };
            let name_style = if is_current {
                Style::default().fg(colors::FG).add_modifier(Modifier::BOLD)
            } else {
                Style::default().fg(colors::FG)
            };
            ListItem::new(vec![
                Line::from(vec![
                    Span::styled(format!("  {} ", if is_current { "●" } else { " " }), Style::default().fg(marker_color)),
                    Span::styled(&p.name, name_style),
                    Span::styled(
                        format!("   {} schema · {} 约束", p.schema_count.unwrap_or(0), p.constraint_count.unwrap_or(0)),
                        Style::default().fg(colors::DIM),
                    ),
                ]),
                Line::from(Span::styled(format!("    {}", p.path), Style::default().fg(colors::DIM))),
            ])
        })
        .collect();

    let list = List::new(items)
        .style(Style::default().bg(colors::BG))
        .highlight_style(Style::default().bg(colors::PANEL))
        .highlight_symbol("");

    let mut state = ListState::default();
    state.select(Some(app.selected_project));
    frame.render_stateful_widget(list, list_area, &mut state);
}
