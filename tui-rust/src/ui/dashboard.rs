//! Dashboard 页：项目扫描 + 打开 + 项目列表

use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::widgets::{Block, Borders, List, ListItem, ListState, Paragraph};
use ratatui::Frame;

use crate::app::{colors, App};

pub fn render(frame: &mut Frame, app: &mut App, area: Rect) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(2), Constraint::Min(1)])
        .split(area);

    // 顶部提示
    let hint = Paragraph::new(format!(
        "  项目列表 ({}) · ↑↓ 选择 · Enter 打开",
        app.projects.len()
    ))
    .style(Style::default().fg(colors::MUTED))
    .block(
        Block::default()
            .borders(Borders::BOTTOM)
            .border_style(Style::default().fg(colors::BORDER)),
    );
    frame.render_widget(hint, chunks[0]);

    // 项目列表
    if app.projects.is_empty() {
        let empty = Paragraph::new(vec![
            ratatui::text::Line::from(""),
            ratatui::text::Line::from(""),
            ratatui::text::Line::from(vec![
                ratatui::text::Span::raw("  "),
                ratatui::text::Span::styled("⚠ ", Style::default().fg(colors::YELLOW)),
                ratatui::text::Span::styled("未找到项目", Style::default().fg(colors::YELLOW).add_modifier(Modifier::BOLD)),
            ]),
            ratatui::text::Line::from(""),
            ratatui::text::Line::from(vec![
                ratatui::text::Span::raw("  可能原因："),
            ]),
            ratatui::text::Line::from(vec![
                ratatui::text::Span::styled("  1. ", Style::default().fg(colors::PRIMARY)),
                ratatui::text::Span::styled("后端未运行 — 先执行 ", Style::default().fg(colors::FG)),
                ratatui::text::Span::styled("npm run backend:dev", Style::default().fg(colors::GREEN)),
            ]),
            ratatui::text::Line::from(vec![
                ratatui::text::Span::styled("  2. ", Style::default().fg(colors::PRIMARY)),
                ratatui::text::Span::styled("扫描路径下无 project.precis.yaml", Style::default().fg(colors::FG)),
            ]),
        ])
        .style(Style::default().bg(colors::BG));
        frame.render_widget(empty, chunks[1]);
        return;
    }

    let current_path = app.api.project_path().unwrap_or("").to_string();
    let items: Vec<ListItem> = app
        .projects
        .iter()
        .enumerate()
        .map(|(i, p)| {
            let is_current = p.path == current_path;
            let name_style = if is_current {
                Style::default().fg(colors::GREEN).add_modifier(Modifier::BOLD)
            } else {
                Style::default().fg(colors::FG)
            };
            let icon = if is_current { "●" } else { "○" };
            ListItem::new(vec![
                ratatui::text::Line::from(vec![
                    ratatui::text::Span::styled(format!(" {}. ", i + 1), Style::default().fg(colors::MUTED)),
                    ratatui::text::Span::styled(format!("{} ", icon), Style::default().fg(if is_current { colors::GREEN } else { colors::MUTED })),
                    ratatui::text::Span::styled(&p.name, name_style),
                    ratatui::text::Span::styled(
                        format!(
                            "  {} schemas · {} constraints",
                            p.schema_count.unwrap_or(0),
                            p.constraint_count.unwrap_or(0)
                        ),
                        Style::default().fg(colors::MUTED),
                    ),
                ]),
                ratatui::text::Line::from(vec![
                    ratatui::text::Span::styled(format!("    {}", p.path), Style::default().fg(colors::BORDER)),
                ]),
            ])
        })
        .collect();

    let list = List::new(items)
        .block(Block::default().style(Style::default().bg(colors::BG)))
        .highlight_style(
            Style::default()
                .fg(colors::PRIMARY)
                .add_modifier(Modifier::BOLD)
                .bg(colors::PANEL),
        )
        .highlight_symbol("▶ ");

    let mut state = ListState::default();
    state.select(Some(app.selected_project));
    frame.render_stateful_widget(list, chunks[1], &mut state);
}
