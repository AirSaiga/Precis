//! Provider 页 — Table widget 保证列对齐 + 连接测试结果

use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Modifier, Style, Stylize};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Paragraph, Row, Table, TableState};
use ratatui::Frame;

use crate::app::{colors, App};

pub fn render(frame: &mut Frame, app: &mut App, area: Rect) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(2), Constraint::Min(1), Constraint::Length(3)])
        .split(area);

    // 提示
    frame.render_widget(
        Paragraph::new("  Provider 列表  j/k 导航  t 测试  a 激活  r 刷新")
            .style(Style::default().fg(colors::MUTED)),
        chunks[0],
    );

    if app.providers.is_empty() {
        frame.render_widget(
            Paragraph::new("\n\n  未配置 Provider\n\n  在后端配置 ~/.precis/ai_providers.yaml")
                .style(Style::default().fg(colors::DIM)),
            chunks[1],
        );
        return;
    }

    let active_id = app.active_provider_id.as_deref().unwrap_or("");

    // Table widget（列对齐可靠）
    let header = Row::new(vec!["", "名称", "类型", "模型", "端点"])
        .style(Style::default().fg(colors::MUTED).add_modifier(Modifier::BOLD));

    let rows: Vec<Row> = app.providers.iter().enumerate().map(|(i, p)| {
        let is_active = p.id == active_id;
        let name_style = if is_active {
            Style::default().fg(colors::FG).add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(colors::FG)
        };
        let marker = if is_active { "●" } else { "" };

        Row::new(vec![
            marker.to_string(),
            truncate(&p.name, 14),
            p.provider_type.clone(),
            truncate(&p.model, 20),
            truncate(&p.base_url, 30),
        ])
        .style(if is_active {
            Style::default().fg(colors::MUTED)
        } else {
            Style::default().fg(colors::MUTED)
        })
    }).collect();

    let table = Table::new(
        rows,
        [Constraint::Length(2), Constraint::Length(16), Constraint::Length(10), Constraint::Length(22), Constraint::Min(10)],
    )
    .header(header)
    .row_highlight_style(Style::default().bg(colors::PANEL).fg(colors::PINK))
    .column_spacing(1)
    .style(Style::default().bg(colors::BG));

    let mut state = TableState::default();
    state.select(Some(app.provider_cursor));
    frame.render_stateful_widget(table, chunks[1], &mut state);

    // 测试结果
    if let Some(ref result) = app.provider_test_result {
        let (icon, msg, color) = match result {
            crate::app::TestResult::Ok(_) => ("✓".to_string(), "连接正常".to_string(), colors::GREEN),
            crate::app::TestResult::Fail(err) => ("✗".to_string(), truncate(err, 50), colors::RED),
        };
        frame.render_widget(
            Paragraph::new(format!("  {} {}", icon, msg))
                .style(Style::default().fg(color).bg(colors::SURFACE)),
            chunks[2],
        );
    }
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let t: String = s.chars().take(max.saturating_sub(1)).collect();
        format!("{}…", t)
    }
}
