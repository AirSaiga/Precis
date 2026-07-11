//! 首页 — 指标卡 + 呼吸动效 + 项目列表（双主题适配）

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

    // ===== 状态区：项目名 + 指标卡 + 分隔 =====
    let mut lines: Vec<Line> = Vec::new();
    lines.push(Line::from(""));

    if app.project_name.is_some() {
        let name = app.project_name.as_deref().unwrap_or("");
        lines.push(Line::from(vec![
            Span::styled("  ● ", Style::default().fg(colors::green())),
            Span::styled(name, Style::default().fg(colors::fg()).add_modifier(Modifier::BOLD)),
            Span::styled("  已打开", Style::default().fg(colors::dim())),
        ]));
        if let Some(p) = app.projects.get(app.selected_project) {
            lines.push(Line::from(Span::styled(
                format!("  {}", p.path),
                Style::default().fg(colors::dim()),
            )));
        }

        // 指标卡：用 box-drawing 细框 + 大号呼吸数字
        if let Some(p) = app.projects.get(app.selected_project) {
            let schema_count = p.schema_count.unwrap_or(0);
            let constraint_count = p.constraint_count.unwrap_or(0);

            // 呼吸：三个数字错开 120° 相位，在原色↔亮色之间 sin 渐变（约 4 秒周期）
            let phase1 = (app.frame_count as f64 * 0.025).sin() * 0.5 + 0.5;
            let phase2 = ((app.frame_count as f64 * 0.025) + 2.094).sin() * 0.5 + 0.5; // +120°
            let phase3 = ((app.frame_count as f64 * 0.025) + 4.189).sin() * 0.5 + 0.5; // +240°

            let num_pink = colors::blend(colors::pink(), colors::fg(), phase1 * 0.35);
            let num_cyan = colors::blend(colors::cyan(), colors::fg(), phase2 * 0.35);
            let num_green = colors::blend(colors::green(), colors::fg(), phase3 * 0.35);

            lines.push(Line::from(""));
            // 指标卡上框
            lines.push(Line::from(Span::styled(
                "  ┌─────────┐  ┌─────────┐  ┌──────────┐",
                Style::default().fg(colors::dim()),
            )));
            // 大号数字行
            lines.push(Line::from(vec![
                Span::styled("  │  ", Style::default().fg(colors::dim())),
                Span::styled(format!("{:<3}", schema_count), Style::default().fg(num_pink).add_modifier(Modifier::BOLD)),
                Span::styled("    │  ", Style::default().fg(colors::dim())),
                Span::styled(format!("{:<3}", constraint_count), Style::default().fg(num_cyan).add_modifier(Modifier::BOLD)),
                Span::styled("    │  ", Style::default().fg(colors::dim())),
                Span::styled(format!("{:<4}", schema_count + constraint_count), Style::default().fg(num_green).add_modifier(Modifier::BOLD)),
                Span::styled("   │", Style::default().fg(colors::dim())),
            ]));
            // 标签行
            lines.push(Line::from(vec![
                Span::styled("  │ Schema  │  │ 约束    │  │ 总计    │", Style::default().fg(colors::muted())),
            ]));
            // 下框
            lines.push(Line::from(Span::styled(
                "  └─────────┘  └─────────┘  └──────────┘",
                Style::default().fg(colors::dim()),
            )));
        }
    } else {
        lines.push(Line::from(vec![
            Span::styled("  ◤◢ Precis", Style::default().fg(colors::pink()).add_modifier(Modifier::BOLD)),
            Span::styled("  本地数据校验工具", Style::default().fg(colors::dim())),
        ]));
        lines.push(Line::from(""));
        lines.push(Line::from(Span::styled(
            "  选择项目后显示指标概览",
            Style::default().fg(colors::dim()),
        )));
    }

    let header = Paragraph::new(lines).style(Style::default().bg(colors::bg()));
    frame.render_widget(header, chunks[0]);

    // ===== 项目列表 =====
    let list_area = chunks[1];

    if app.projects.is_empty() {
        let empty = Paragraph::new("\n\n  未找到项目\n\n  确保后端正在运行 (npm run backend:dev)\n  且扫描目录下有 project.precis.yaml")
            .style(Style::default().fg(colors::dim()));
        frame.render_widget(empty, list_area);
        return;
    }

    // 分隔线 + 提示
    let list_split = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(2), Constraint::Min(1)])
        .split(list_area);

    let hint_lines = vec![
        Line::from(Span::styled(
            format!("  项目 ({})  j/k 选择  Enter 打开", app.projects.len()),
            Style::default().fg(colors::muted()),
        )),
        Line::from(""),
    ];
    frame.render_widget(
        Paragraph::new(hint_lines).style(Style::default().bg(colors::bg())),
        list_split[0],
    );

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
            ListItem::new(vec![
                Line::from(vec![
                    Span::styled(
                        format!(" {}{} ", prefix, if is_current { "●" } else { " " }),
                        Style::default().fg(if is_selected { colors::pink() } else { if is_current { colors::green() } else { colors::dim() } }),
                    ),
                    Span::styled(&p.name, name_style),
                    Span::styled(
                        format!("   {} schema · {} 约束", p.schema_count.unwrap_or(0), p.constraint_count.unwrap_or(0)),
                        Style::default().fg(colors::cyan()),
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

    // 列表渲染到 hint 下方的区域
    frame.render_stateful_widget(list, list_split[1], &mut state);
}
