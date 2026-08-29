//! 概览页 — 双栏布局：项目信息 + Schema/约束清单 | 清单覆盖诊断

use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;
use ratatui::Frame;

use super::widgets;
use crate::app::{colors, layout, App};
use crate::i18n::pick;
use crate::icons;

/// 覆盖度资源类别（后端 coverage_to_api_dict 的分组 key → 显示名；i18n 词对在调用时解析）
fn categories() -> [(&'static str, &'static str); 5] {
    [
        ("schemas", "Schema"),
        ("constraints", pick("约束", "Constraints")),
        ("regex_nodes", pick("正则", "Regex")),
        ("transforms", pick("转换", "Transforms")),
        ("manual_data", pick("手动数据", "Manual data")),
    ]
}

pub fn render(frame: &mut Frame, app: &mut App, area: Rect) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(layout::CONFIG_HINT), Constraint::Min(1)])
        .split(area);

    // 提示行
    let hint = widgets::chips_line(&[("r", pick("刷新", "Refresh"))]);
    frame.render_widget(Paragraph::new(vec![Line::from(""), hint]), chunks[0]);

    let Some(config) = &app.config_data else {
        frame.render_widget(
            Paragraph::new(vec![
                Line::from(""),
                Line::from(Span::styled(
                    format!(
                        "  {}",
                        pick(
                            "按 r 加载配置（需先在首页打开项目）",
                            "Press r to load config (open a project on Home first)"
                        )
                    ),
                    Style::default().fg(colors::dim()),
                )),
            ]),
            chunks[1],
        );
        return;
    };

    let wide = area.width >= layout::CARD_ROW_MIN_WIDTH;
    let col_width = if wide {
        (area.width as usize / 2).saturating_sub(2)
    } else {
        area.width as usize
    };

    let left = build_left(config, col_width);
    let right = build_right(config, col_width);

    // 宽屏双栏、窄屏单栏纵排
    if wide {
        let cols = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Ratio(1, 2), Constraint::Ratio(1, 2)])
            .split(chunks[1]);
        frame.render_widget(
            Paragraph::new(left).style(Style::default().bg(colors::bg())),
            cols[0],
        );
        frame.render_widget(
            Paragraph::new(right).style(Style::default().bg(colors::bg())),
            cols[1],
        );
    } else {
        let mut all = left;
        all.push(Line::from(""));
        all.extend(right);
        frame.render_widget(
            Paragraph::new(all).style(Style::default().bg(colors::bg())),
            chunks[1],
        );
    }
}

/// 左栏：项目信息 + Schema 清单 + 约束清单
fn build_left(config: &crate::api::types::FullConfigResponse, width: usize) -> Vec<Line<'static>> {
    let mut lines: Vec<Line> = Vec::new();
    let Some(manifest) = config.manifest.as_object() else {
        return lines;
    };

    // 项目名（id 与名称相同或为空时不重复显示）
    if let Some(project) = manifest.get("project").and_then(|v| v.as_object()) {
        let name = project
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or(pick("未知", "Unknown"));
        let id = project.get("id").and_then(|v| v.as_str()).unwrap_or("");
        let mut spans = vec![
            Span::raw(" "),
            Span::styled(
                name.to_string(),
                Style::default()
                    .fg(colors::fg())
                    .add_modifier(Modifier::BOLD),
            ),
        ];
        if !id.is_empty() && id != name {
            spans.push(Span::styled(
                format!("  ({})", id),
                Style::default().fg(colors::dim()),
            ));
        }
        lines.push(Line::from(spans));
    }

    // Schema 清单
    if let Some(schemas) = manifest.get("schemas").and_then(|v| v.as_array()) {
        lines.push(Line::from(""));
        lines.push(widgets::section_header(
            "◇",
            "Schema",
            Some(schemas.len()),
            width,
        ));
        for s in schemas.iter().take(8) {
            let sid = s.get("id").and_then(|v| v.as_str()).unwrap_or("?");
            let spath = s.get("path").and_then(|v| v.as_str()).unwrap_or("");
            lines.push(resource_line(sid, spath, width));
        }
        if schemas.len() > 8 {
            lines.push(more_line(schemas.len() - 8));
        }
    }

    // 约束清单
    if let Some(constraints) = manifest.get("constraints").and_then(|v| v.as_array()) {
        lines.push(Line::from(""));
        lines.push(widgets::section_header(
            "◆",
            pick("约束", "Constraints"),
            Some(constraints.len()),
            width,
        ));
        for c in constraints.iter().take(6) {
            let cid = c.get("id").and_then(|v| v.as_str()).unwrap_or("?");
            let cpath = c.get("path").and_then(|v| v.as_str()).unwrap_or("");
            lines.push(resource_line(cid, cpath, width));
        }
        if constraints.len() > 6 {
            lines.push(more_line(constraints.len() - 6));
        }
    }

    lines
}

/// 右栏：清单覆盖诊断（is_complete + unlisted/dangling 分类计数）
fn build_right(config: &crate::api::types::FullConfigResponse, width: usize) -> Vec<Line<'static>> {
    let mut lines: Vec<Line> = vec![
        widgets::section_header("◉", pick("清单覆盖", "Manifest coverage"), None, width),
        Line::from(""),
    ];

    let Some(coverage) = config.coverage.as_ref().and_then(|c| c.as_object()) else {
        lines.push(Line::from(Span::styled(
            format!("  {}", pick("暂无覆盖度数据", "No coverage data yet")),
            Style::default().fg(colors::dim()),
        )));
        return lines;
    };

    let is_complete = coverage
        .get("is_complete")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if is_complete {
        let mut spans = vec![Span::raw("  ")];
        spans.extend(widgets::badge(
            &format!("✓ {}", pick("清单完整", "Manifest complete")),
            colors::green(),
        ));
        lines.push(Line::from(spans));
        lines.push(Line::from(Span::styled(
            format!(
                "  {}",
                pick(
                    "磁盘文件与清单引用一致",
                    "Disk files match manifest references"
                )
            ),
            Style::default().fg(colors::dim()),
        )));
        return lines;
    }

    // 不完整：总徽章 + 分组明细
    let mut spans = vec![Span::raw("  ")];
    spans.extend(widgets::badge(
        &format!("✗ {}", pick("清单不一致", "Manifest mismatch")),
        colors::yellow(),
    ));
    lines.push(Line::from(spans));

    for (group_key, group_label, group_color) in [
        ("unlisted", pick("未入清单", "Unlisted"), colors::yellow()),
        ("dangling", pick("悬空引用", "Dangling"), colors::red()),
    ] {
        let Some(group) = coverage.get(group_key).and_then(|g| g.as_object()) else {
            continue;
        };
        let total: usize = group
            .values()
            .filter_map(|v| v.as_array())
            .map(|a| a.len())
            .sum();
        if total == 0 {
            continue;
        }
        lines.push(Line::from(""));
        lines.push(Line::from(vec![
            Span::styled("  ■ ", Style::default().fg(group_color)),
            Span::styled(
                group_label.to_string(),
                Style::default()
                    .fg(colors::fg())
                    .add_modifier(Modifier::BOLD),
            ),
            Span::styled(format!(" ({})", total), Style::default().fg(colors::dim())),
        ]));
        for (cat_key, cat_label) in categories() {
            let Some(items) = group
                .get(cat_key)
                .and_then(|v| v.as_array())
                .filter(|a| !a.is_empty())
            else {
                continue;
            };
            let ids: Vec<&str> = items
                .iter()
                .take(4)
                .filter_map(|it| it.get("id").and_then(|v| v.as_str()))
                .collect();
            let more = if items.len() > 4 {
                format!(" +{}", items.len() - 4)
            } else {
                String::new()
            };
            let text = format!("{}{}", ids.join(", "), more);
            lines.push(Line::from(vec![
                Span::styled(
                    format!("    {}  ", cat_label),
                    Style::default().fg(colors::muted()),
                ),
                Span::styled(
                    icons::truncate(&text, width.saturating_sub(14).max(8)),
                    Style::default().fg(colors::dim()),
                ),
            ]));
        }
    }

    lines
}

/// 资源条目行：`◦ id  path`
fn resource_line(id: &str, path: &str, width: usize) -> Line<'static> {
    let id_w = (width / 3).clamp(8, 20);
    Line::from(vec![
        Span::styled("  ◦ ", Style::default().fg(colors::cyan())),
        Span::styled(
            widgets::truncate_width(id, id_w),
            Style::default().fg(colors::fg()),
        ),
        Span::styled(
            format!(
                "  {}",
                icons::truncate(path, width.saturating_sub(id_w + 6).max(8))
            ),
            Style::default().fg(colors::dim()),
        ),
    ])
}

/// "还有 N 个"行
fn more_line(n: usize) -> Line<'static> {
    Line::from(Span::styled(
        format!(
            "    ... {} {} {}",
            pick("还有", "and"),
            n,
            pick("个", "more")
        ),
        Style::default().fg(colors::dim()),
    ))
}
