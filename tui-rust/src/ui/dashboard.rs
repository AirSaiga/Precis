//! 首页 — hero / 指标卡片 + 全宽项目列表

use ratatui::layout::{Alignment, Constraint, Direction, Layout, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{List, ListItem, ListState, Paragraph};
use ratatui::Frame;

use super::widgets;
use crate::app::{colors, layout, App};
use crate::icons;

pub fn render(frame: &mut Frame, app: &mut App, area: Rect) {
    if area.height == 0 || area.width == 0 {
        return;
    }
    let mut y = area.y;
    let bottom = area.y + area.height;

    // — 顶部区：已打开项目 → 指标卡；未打开 → hero —
    if app.project_name.is_some() {
        y = render_metrics(frame, app, area, y);
    } else {
        // hero：ASCII 渐变字标 + 标语（居中），主题装饰符收尾
        let motif = if colors::theme() == 1 { icons::motif::SNOW } else { icons::motif::SAKURA };
        let a = colors::gradient_a();
        let b = colors::gradient_b();
        let logo_w = super::splash::LOGO
            .iter()
            .map(|l| l.chars().count())
            .max()
            .unwrap_or(1) as f64;
        let mut hero: Vec<Line> = vec![Line::from("")];
        for logo_line in super::splash::LOGO {
            let spans: Vec<Span> = logo_line
                .chars()
                .enumerate()
                .map(|(i, c)| {
                    let t = if logo_w > 1.0 { i as f64 / (logo_w - 1.0) } else { 0.0 };
                    Span::styled(
                        c.to_string(),
                        Style::default().fg(colors::blend(a, b, t)).add_modifier(Modifier::BOLD),
                    )
                })
                .collect();
            hero.push(Line::from(spans));
        }
        hero.push(Line::from(""));
        hero.push(Line::from(vec![
            Span::styled(format!("{} ", motif), Style::default().fg(a)),
            Span::styled("本地数据校验工具", Style::default().fg(colors::muted())),
            Span::styled(format!(" {}", motif), Style::default().fg(b)),
        ]));
        let hero_h = hero.len() as u16 + 1;
        if bottom.saturating_sub(y) >= hero_h {
            frame.render_widget(
                Paragraph::new(hero).alignment(Alignment::Center),
                Rect { x: area.x, y, width: area.width, height: hero_h },
            );
            y += hero_h;
        }
    }

    // — 项目节标题 + 操作提示 —
    if bottom.saturating_sub(y) < 3 {
        return;
    }
    let header = widgets::section_header("◈", "项目", Some(app.projects.len()), area.width as usize);
    let hint = widgets::chips_line(&[("j/k", "选择"), ("Enter", "打开")]);
    frame.render_widget(
        Paragraph::new(vec![header, hint, Line::from("")]),
        Rect { x: area.x, y, width: area.width, height: 3 },
    );
    y += 3;

    // — 项目列表（全宽单行条目）—
    let list_h = bottom.saturating_sub(y);
    if list_h == 0 {
        return;
    }
    if app.projects.is_empty() {
        frame.render_widget(
            Paragraph::new(Line::from(Span::styled(
                "  未发现项目（检查 PRECIS_WORK_DIR 指向的目录）",
                Style::default().fg(colors::dim()),
            ))),
            Rect { x: area.x, y, width: area.width, height: 1 },
        );
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
            let prefix = if is_selected { icons::SELECTED } else { " " };
            let prefix_color = if is_selected { colors::pink() } else { colors::dim() };
            let (dot, dot_color) = if is_current {
                (icons::status::CONNECTED, colors::green())
            } else {
                (icons::status::DISCONNECTED, colors::dim())
            };
            let name_style = if is_current {
                Style::default().fg(colors::fg()).add_modifier(Modifier::BOLD)
            } else {
                Style::default().fg(colors::fg())
            };
            let mut spans = vec![
                Span::raw(" "),
                Span::styled(prefix, Style::default().fg(prefix_color)),
                Span::styled(dot, Style::default().fg(dot_color)),
                Span::raw(" "),
                Span::styled(p.name.clone(), name_style),
                Span::raw("  "),
                Span::styled(
                    format!("{} schema", p.schema_count.unwrap_or(0)),
                    Style::default().fg(colors::cyan()),
                ),
                Span::styled(" · ", Style::default().fg(colors::dim())),
                Span::styled(
                    format!("{} 约束", p.constraint_count.unwrap_or(0)),
                    Style::default().fg(colors::pink()),
                ),
            ];
            if is_current {
                spans.push(Span::raw("  "));
                spans.extend(widgets::badge("当前", colors::green()));
            }
            // 路径并入行尾（dim、截断）
            let path_budget = (area.width as usize).saturating_sub(48);
            spans.push(Span::styled(
                format!("   {}", icons::truncate(&p.path, path_budget.max(10))),
                Style::default().fg(colors::dim()),
            ));
            ListItem::new(Line::from(spans))
        })
        .collect();

    let list = List::new(items)
        .style(Style::default().bg(colors::bg()))
        .highlight_style(Style::default().bg(colors::panel()))
        .highlight_symbol("");

    let mut state = ListState::default();
    state.select(Some(app.selected_project));
    frame.render_stateful_widget(
        list,
        Rect { x: area.x, y, width: area.width, height: list_h },
        &mut state,
    );
}

/// 指标卡片区（返回下一块内容的起始 y）
fn render_metrics(frame: &mut Frame, app: &App, area: Rect, y: u16) -> u16 {
    let bottom = area.y + area.height;
    let Some(p) = app.projects.get(app.selected_project) else {
        return y;
    };
    let sc = p.schema_count.unwrap_or(0);
    let cc = p.constraint_count.unwrap_or(0);
    let t = app.frame_count as f64 * 0.025;
    let ph1 = t.sin() * 0.5 + 0.5;
    let ph2 = (t + 2.094).sin() * 0.5 + 0.5;
    let ph3 = (t + 4.189).sin() * 0.5 + 0.5;
    let cards: [(String, &str, ratatui::style::Color, f64); 3] = [
        (sc.to_string(), "Schema", colors::pink(), ph1),
        (cc.to_string(), "约束", colors::cyan(), ph2),
        ((sc + cc).to_string(), "总计", colors::green(), ph3),
    ];

    let mut y = y;
    let wide = area.width >= layout::CARD_ROW_MIN_WIDTH;
    if wide && bottom.saturating_sub(y) >= 4 {
        // 横排三卡（卡间留 1 列空隙）
        let cols = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Ratio(1, 3); 3])
            .split(Rect { x: area.x, y, width: area.width, height: 4 });
        for (i, (value, label, accent, ph)) in cards.iter().enumerate() {
            let mut r = cols[i];
            if i > 0 {
                r.x += 1;
                r.width = r.width.saturating_sub(1);
            }
            widgets::stat_card(frame, r, value, label, *accent, *ph);
        }
        y += 4;
    } else if !wide && bottom.saturating_sub(y) >= 12 {
        // 窄终端纵排
        for (value, label, accent, ph) in &cards {
            widgets::stat_card(
                frame,
                Rect { x: area.x, y, width: area.width, height: 4 },
                value,
                label,
                *accent,
                *ph,
            );
            y += 4;
        }
    }

    // 项目名 + 路径行
    if bottom > y {
        frame.render_widget(
            Paragraph::new(Line::from(vec![
                Span::styled(" ● ", Style::default().fg(colors::green())),
                Span::styled(
                    p.name.clone(),
                    Style::default().fg(colors::fg()).add_modifier(Modifier::BOLD),
                ),
                Span::styled("  已打开", Style::default().fg(colors::green())),
                Span::styled(format!("   {}", p.path), Style::default().fg(colors::dim())),
            ])),
            Rect { x: area.x, y, width: area.width, height: 1 },
        );
        y += 2;
    }
    y
}
