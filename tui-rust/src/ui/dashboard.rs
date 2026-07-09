//! Dashboard 页：项目扫描 + 打开 + 项目列表

use ratatui::layout::{Constraint, Direction, Layout};
use ratatui::style::{Color, Modifier, Style};
use ratatui::widgets::{Block, Borders, List, ListItem, ListState, Paragraph, Wrap};
use ratatui::Frame;

use crate::app::App;
use crate::ui::colors;

pub fn render(frame: &mut Frame, app: &mut App, area: ratatui::layout::Rect) {
    let (_, fg, primary, _accent, green, _red, yellow, muted) = colors();

    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(3), Constraint::Min(1)])
        .split(area);

    // 顶部提示
    let hint = Paragraph::new(format!(
        "项目列表 ({}) · ↑↓ 选择 · Enter 打开 · Tab 切换到校验页",
        app.projects.len()
    ))
    .style(Style::default().fg(muted))
    .block(
        Block::default()
            .borders(Borders::BOTTOM)
            .border_style(Style::default().fg(Color::Rgb(45, 53, 72))),
    );
    frame.render_widget(hint, chunks[0]);

    // 项目列表
    if app.projects.is_empty() {
        let empty = Paragraph::new(vec![
            ratatui::text::Line::from(""),
            ratatui::text::Line::from(vec![
                ratatui::text::Span::styled("⚠ ", Style::default().fg(yellow)),
                ratatui::text::Span::styled("未找到项目", Style::default().fg(yellow).add_modifier(Modifier::BOLD)),
            ]),
            ratatui::text::Line::from(""),
            ratatui::text::Line::from("可能原因："),
            ratatui::text::Line::from(vec![
                ratatui::text::Span::styled("  1. ", Style::default().fg(primary)),
                ratatui::text::Span::styled("后端未运行 — 先执行 ", Style::default().fg(fg)),
                ratatui::text::Span::styled("npm run backend:dev", Style::default().fg(green)),
            ]),
            ratatui::text::Line::from(vec![
                ratatui::text::Span::styled("  2. ", Style::default().fg(primary)),
                ratatui::text::Span::styled("扫描路径下无 project.precis.yaml", Style::default().fg(fg)),
            ]),
        ])
        .style(Style::default().bg(Color::Rgb(22, 22, 30)))
        .wrap(Wrap { trim: true });
        frame.render_widget(empty, chunks[1]);
        return;
    }

    let items: Vec<ListItem> = app
        .projects
        .iter()
        .enumerate()
        .map(|(i, p)| {
            let name_style = if Some(i) == app.projects.iter().position(|x| x.path == app.api.project_path().unwrap_or("")) {
                Style::default().fg(green).add_modifier(Modifier::BOLD)
            } else {
                Style::default().fg(fg)
            };
            ListItem::new(vec![
                ratatui::text::Line::from(vec![
                    ratatui::text::Span::styled(format!(" {}. ", i + 1), Style::default().fg(muted)),
                    ratatui::text::Span::styled(&p.name, name_style),
                    ratatui::text::Span::styled(
                        format!(
                            "  {} schemas, {} constraints",
                            p.schema_count.unwrap_or(0),
                            p.constraint_count.unwrap_or(0)
                        ),
                        Style::default().fg(muted),
                    ),
                ]),
                ratatui::text::Line::from(vec![
                    ratatui::text::Span::styled(format!("   {}", p.path), Style::default().fg(Color::Rgb(45, 53, 72))),
                ]),
            ])
        })
        .collect();

    let list = List::new(items)
        .block(Block::default().style(Style::default().bg(Color::Rgb(22, 22, 30))))
        .highlight_style(
            Style::default()
                .fg(primary)
                .add_modifier(Modifier::BOLD)
                .bg(Color::Rgb(36, 40, 59)),
        )
        .highlight_symbol("▶ ");

    let mut state = ListState::default();
    state.select(Some(app.selected_project));
    frame.render_stateful_widget(list, chunks[1], &mut state);

    // 选中项目的提示（如果有）
    if let Some(p) = app.projects.get(app.selected_project) {
        let info = Paragraph::new(format!("→ {} ({})", p.name, p.path))
            .style(Style::default().fg(yellow));
        frame.render_widget(
            info,
            chunks[0].inner(ratatui::layout::Margin {
                horizontal: 0,
                vertical: 0,
            }),
        );
    }
}
