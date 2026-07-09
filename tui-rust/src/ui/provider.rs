//! Provider 页 — 列表 + 连接测试 + 激活

use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Modifier, Style, Stylize};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Paragraph, Row, Table, TableState};
use ratatui::Frame;

use crate::app::{colors, App};

pub fn render(frame: &mut Frame, app: &mut App, area: Rect) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(2), Constraint::Min(1)])
        .split(area);

    // 提示
    frame.render_widget(
        Paragraph::new("  Provider 列表  t 测试连接  a 设为活跃")
            .style(Style::default().fg(colors::MUTED)),
        chunks[0],
    );

    let providers = &app.providers;

    if providers.is_empty() {
        frame.render_widget(
            Paragraph::new("\n\n  未配置 Provider\n\n  在后端配置 ~/.precis/ai_providers.yaml 添加 Provider")
                .style(Style::default().fg(colors::DIM)),
            chunks[1],
        );
        return;
    }

    // Provider 表格
    let active_id = app.active_provider_id.as_deref().unwrap_or("");

    let header = Row::new(vec!["", "名称", "类型", "模型", "端点"])
        .style(Style::default().fg(colors::DIM));

    let rows: Vec<Row> = providers
        .iter()
        .enumerate()
        .map(|(i, p)| {
            let is_active = p.id == active_id;
            let marker = if is_active { "●" } else { " " };
            let marker_color = if is_active { colors::GREEN } else { colors::DIM };
            let name_style = if is_active {
                Style::default().fg(colors::FG).add_modifier(Modifier::BOLD)
            } else {
                Style::default().fg(colors::FG)
            };
            let bg = if i % 2 == 0 { colors::BG } else { colors::SURFACE };

            Row::new(vec![
                marker.to_string(),
                format!("{}", p.name),
                p.provider_type.clone(),
                p.model.clone(),
                truncate(&p.base_url, 30),
            ])
            .style(Style::default().bg(bg).fg(colors::MUTED))
        })
        .collect();

    // 调整：用手动渲染让 marker/name 有不同颜色
    let mut lines: Vec<Line> = Vec::new();
    lines.push(Line::from(Span::styled(" ", Style::default())));
    for (i, p) in providers.iter().enumerate() {
        let is_active = p.id == active_id;
        let marker_color = if is_active { colors::GREEN } else { colors::DIM };
        let name_style = if is_active {
            Style::default().fg(colors::FG).add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(colors::FG)
        };
        let bg = if i == app.provider_cursor { colors::PANEL } else if i % 2 == 0 { colors::BG } else { colors::SURFACE };

        lines.push(Line::from(vec![
            Span::styled(format!("  {} ", if is_active { "●" } else { " " }), Style::default().fg(marker_color)),
            Span::styled(format!("{:<16}", truncate(&p.name, 14)), name_style),
            Span::styled(format!("  {:<8}", p.provider_type), Style::default().fg(colors::MUTED)),
            Span::styled(format!("  {:<20}", truncate(&p.model, 18)), Style::default().fg(colors::MUTED)),
            Span::styled(truncate(&p.base_url, 28), Style::default().fg(colors::DIM)),
        ]).style(Style::default().bg(bg)));
    }

    let list = Paragraph::new(lines).style(Style::default().bg(colors::BG));
    frame.render_widget(list, chunks[1]);

    // 测试结果（如果有）
    if let Some(ref result) = app.provider_test_result {
        let test_area = Rect {
            x: area.x,
            y: area.y + area.height.saturating_sub(4),
            width: area.width,
            height: 3,
        };
        let (icon, msg, color) = match result {
            crate::app::TestResult::Ok(latency) => ("✓", format!("连接正常 · {}ms", latency), colors::GREEN),
            crate::app::TestResult::Fail(err) => ("✗", format!("连接失败 · {}", truncate_str(err, 40)), colors::RED),
        };
        frame.render_widget(
            Paragraph::new(format!("  {} {}", icon, msg)).style(Style::default().fg(color).bg(colors::SURFACE)),
            test_area,
        );
    }
}

fn truncate(s: &str, max: usize) -> String {
    truncate_str(s, max)
}

fn truncate_str(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let t: String = s.chars().take(max.saturating_sub(1)).collect();
        format!("{}…", t)
    }
}
