//! 首页 — 指标卡 + 呼吸动效 + 项目列表（双主题适配）

use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{List, ListItem, ListState, Paragraph};
use ratatui::Frame;

use crate::app::{colors, App};

pub fn render(frame: &mut Frame, app: &mut App, area: Rect) {
    // 状态区(12行，容纳项目名+指标卡+提示) + 项目列表(填充)
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(12), Constraint::Min(1)])
        .split(area);

    // ===== 状态区 =====
    let mut lines: Vec<Line> = Vec::new();

    if app.project_name.is_some() {
        let name = app.project_name.as_deref().unwrap_or("");
        // 项目名行
        lines.push(Line::from(vec![
            Span::raw(" "),
            Span::styled("●", Style::default().fg(colors::green())),
            Span::raw(" "),
            Span::styled(name, Style::default().fg(colors::fg()).add_modifier(Modifier::BOLD)),
            Span::raw("  "),
            Span::styled("已打开", Style::default().fg(colors::dim())),
        ]));

        // 指标行（大号呼吸数字，不用 box-drawing 避免中文宽度问题）
        if let Some(p) = app.projects.get(app.selected_project) {
            let sc = p.schema_count.unwrap_or(0);
            let cc = p.constraint_count.unwrap_or(0);

            // 呼吸：三个数字错开 120° 相位
            let t = app.frame_count as f64 * 0.025;
            let phase1 = t.sin() * 0.5 + 0.5;
            let phase2 = (t + 2.094).sin() * 0.5 + 0.5;
            let phase3 = (t + 4.189).sin() * 0.5 + 0.5;

            let num1 = colors::blend(colors::pink(), colors::fg(), phase1 * 0.4);
            let num2 = colors::blend(colors::cyan(), colors::fg(), phase2 * 0.4);
            let num3 = colors::blend(colors::green(), colors::fg(), phase3 * 0.4);

            lines.push(Line::from(""));
            // 用分隔符代替 box-drawing，避免对齐问题
            lines.push(Line::from(vec![
                Span::raw(" "),
                Span::styled(format!("  {}", sc), Style::default().fg(num1).add_modifier(Modifier::BOLD)),
                Span::raw("  "),
                Span::styled("Schema", Style::default().fg(colors::muted())),
                Span::raw("    "),
                Span::styled(format!("{}", cc), Style::default().fg(num2).add_modifier(Modifier::BOLD)),
                Span::raw("  "),
                Span::styled("约束", Style::default().fg(colors::muted())),
                Span::raw("    "),
                Span::styled(format!("{}", sc + cc), Style::default().fg(num3).add_modifier(Modifier::BOLD)),
                Span::raw("  "),
                Span::styled("总计", Style::default().fg(colors::muted())),
            ]));

            // 路径
            lines.push(Line::from(""));
            lines.push(Line::from(Span::styled(
                format!("  {}", p.path),
                Style::default().fg(colors::dim()),
            )));
        }
    } else {
        lines.push(Line::from(vec![
            Span::raw(" "),
            Span::styled("◤◢", Style::default().fg(colors::pink()).add_modifier(Modifier::BOLD)),
            Span::raw(" "),
            Span::styled("Precis", Style::default().fg(colors::fg()).add_modifier(Modifier::BOLD)),
            Span::raw("  "),
            Span::styled("本地数据校验工具", Style::default().fg(colors::dim())),
        ]));
        lines.push(Line::from(""));
        lines.push(Line::from(Span::styled(
            "  选择项目后显示指标概览",
            Style::default().fg(colors::dim()),
        )));
    }

    // 分隔线
    lines.push(Line::from(""));
    lines.push(Line::from(Span::styled(
        format!("  项目 ({})  j/k 选择  Enter 打开", app.projects.len()),
        Style::default().fg(colors::muted()),
    )));

    frame.render_widget(
        Paragraph::new(lines).style(Style::default().bg(colors::bg())),
        chunks[0],
    );

    // ===== 项目列表 =====
    let list_area = chunks[1];

    if app.projects.is_empty() {
        let empty = Paragraph::new("\n  未找到项目\n\n  确保后端正在运行 (npm run backend:dev)\n  且扫描目录下有 project.precis.yaml")
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
            let name_style = if is_current {
                Style::default().fg(colors::fg()).add_modifier(Modifier::BOLD)
            } else {
                Style::default().fg(colors::fg())
            };
            let prefix = if is_selected { "▸" } else { " " };
            let dot = if is_current { "●" } else { " " };
            let dot_color = if is_selected {
                colors::pink()
            } else if is_current {
                colors::green()
            } else {
                colors::dim()
            };
            ListItem::new(vec![
                Line::from(vec![
                    Span::raw(" "),
                    Span::styled(prefix, Style::default().fg(if is_selected { colors::pink() } else { colors::dim() })),
                    Span::styled(dot, Style::default().fg(dot_color)),
                    Span::raw(" "),
                    Span::styled(&p.name, name_style),
                    Span::raw("   "),
                    Span::styled(
                        format!("{} schema · {} 约束", p.schema_count.unwrap_or(0), p.constraint_count.unwrap_or(0)),
                        Style::default().fg(colors::cyan()),
                    ),
                ]),
                Line::from(Span::styled(format!("    {}", p.path), Style::default().fg(colors::dim()))),
                Line::from(""),
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
