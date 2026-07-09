//! Dashboard 页：项目列表，选中用背景色区分，打开项目用 ● 标记

use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Modifier, Style, Stylize};
use ratatui::widgets::{Block, Borders, List, ListItem, ListState, Paragraph};
use ratatui::Frame;

use crate::app::{colors, App};
use crate::icons;

pub fn render(frame: &mut Frame, app: &mut App, area: Rect) {
    // 内容区内边距 1 行
    let padded = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(1), Constraint::Min(1)])
        .split(area);

    // 提示行
    let hint = Paragraph::new(format!(
        "  Projects ({})  j/k 导航  Enter 打开",
        app.projects.len()
    ))
    .style(Style::default().fg(colors::MUTED));
    frame.render_widget(hint, padded[0]);

    // 空状态
    if app.projects.is_empty() {
        let empty = Paragraph::new(vec![
            ratatui::text::Line::from(""),
            ratatui::text::Line::from(""),
            ratatui::text::Line::from(vec![
                Span::raw("  "),
                Span::styled(
                    format!("{} ", icons::result::WARN),
                    Style::default().fg(colors::YELLOW),
                ),
                Span::styled("No projects found", Style::default().fg(colors::YELLOW).add_modifier(Modifier::BOLD)),
            ]),
            ratatui::text::Line::from(""),
            ratatui::text::Line::from(Span::styled(
                "  1. Backend not running? Try: npm run backend:dev",
                Style::default().fg(colors::FG),
            )),
            ratatui::text::Line::from(Span::styled(
                "  2. No project.precis.yaml in scan directory",
                Style::default().fg(colors::FG),
            )),
        ])
        .style(Style::default().bg(colors::BG));
        frame.render_widget(empty, padded[1]);
        return;
    }

    let current_path = app.api.project_path().unwrap_or("").to_string();

    let items: Vec<ListItem> = app
        .projects
        .iter()
        .map(|p| {
            let is_current = p.path == current_path;
            let marker = if is_current { icons::status::CONNECTED } else { " " };
            let marker_color = if is_current { colors::GREEN } else { colors::MUTED };
            let name_style = if is_current {
                Style::default().fg(colors::GREEN).add_modifier(Modifier::BOLD)
            } else {
                Style::default().fg(colors::FG)
            };

            ListItem::new(vec![
                ratatui::text::Line::from(vec![
                    Span::raw(" "),
                    Span::styled(format!("{} ", marker), Style::default().fg(marker_color)),
                    Span::styled(&p.name, name_style),
                    Span::styled(
                        format!(
                            "   {} schemas, {} constraints",
                            p.schema_count.unwrap_or(0),
                            p.constraint_count.unwrap_or(0)
                        ),
                        Style::default().fg(colors::MUTED),
                    ),
                ]),
                ratatui::text::Line::from(Span::styled(
                    format!("   {}", p.path),
                    Style::default().fg(colors::BORDER),
                )),
            ])
        })
        .collect();

    let list = List::new(items)
        .style(Style::default().bg(colors::BG))
        .highlight_style(
            Style::default()
                .bg(colors::PANEL)
                .fg(colors::PRIMARY)
                .add_modifier(Modifier::BOLD),
        )
        .highlight_symbol(""); // 不用 ▸ 前缀（靠背景色区分选中）

    let mut state = ListState::default();
    state.select(Some(app.selected_project));
    frame.render_stateful_widget(list, padded[1], &mut state);
}

use ratatui::text::Span;
