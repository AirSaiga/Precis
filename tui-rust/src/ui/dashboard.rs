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
        let empty = Paragraph::new("暂无项目。\n请确保后端正在运行，且工作目录下有含 project.precis.yaml 的项目。")
            .style(Style::default().fg(muted))
            .wrap(Wrap { trim: true })
            .alignment(ratatui::layout::Alignment::Center);
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
