//! UI 渲染入口 — 顶部标签栏布局：品牌行 / tab 栏（含滑动指示条）/ 全宽内容区 / 双行状态栏

pub mod chat;
pub mod config;
pub mod dashboard;
pub mod provider;
pub mod splash;
pub mod validation;
pub mod widgets;

use ratatui::buffer::Buffer;
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Paragraph};
use ratatui::Frame;

use crate::app::{colors, layout, App, Phase, Tab, ValidationState};
use crate::icons;

/// 当前 tab 对应的主题色
fn tab_accent(tab: &Tab) -> Color {
    match tab {
        Tab::Dashboard => colors::cyan(),
        Tab::Validation => colors::pink(),
        Tab::Provider => colors::green(),
        Tab::Config => colors::yellow(),
        Tab::Chat => colors::purple(),
    }
}

pub fn render(frame: &mut Frame, app: &mut App) {
    let area = frame.area();
    app.tick();

    // 全局背景
    frame.render_widget(Block::default().style(Style::default().bg(colors::bg())), area);

    // Splash 阶段：启动画面 + 飘落粒子背景
    if app.phase == Phase::Splash {
        splash::render(frame, app.splash_frame, area);
        app.splash_frame += 1;
        if app.splash_frame >= splash::SPLASH_FRAMES {
            app.phase = Phase::Running;
        }
        if app.fx_enabled {
            app.fx.update(area);
            app.fx.render(frame.buffer_mut(), area);
        }
        return;
    }

    // 布局：品牌行 + tab 栏(2 行) + 内容区 + 状态栏(2 行)
    let main = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(layout::BRAND_HEIGHT),
            Constraint::Length(layout::TABS_HEIGHT),
            Constraint::Min(1),
            Constraint::Length(layout::FOOTER_HEIGHT),
        ])
        .split(area);

    render_brand(frame, app, main[0]);
    render_tabs(frame, app, main[1]);

    // 内容区（左右内边距）
    let content = Rect {
        x: main[2].x + layout::CONTENT_PADDING,
        y: main[2].y,
        width: main[2].width.saturating_sub(layout::CONTENT_PADDING * 2),
        height: main[2].height,
    };
    match app.current_tab {
        Tab::Dashboard => dashboard::render(frame, app, content),
        Tab::Validation => validation::render(frame, app, content),
        Tab::Provider => provider::render(frame, app, content),
        Tab::Config => config::render(frame, app, content),
        Tab::Chat => chat::render(frame, app, content),
    }

    render_footer(frame, app, main[3]);

    // 内容淡入 post-pass：切 tab 后数帧内把内容区颜色向 bg 渐隐
    if app.content_fade > 0 {
        let factor = app.content_fade as f64 / layout::CONTENT_FADE_FRAMES as f64 * 0.5;
        apply_fade(frame.buffer_mut(), main[2], factor);
    }

    // 动效：微光场 + 飘落粒子（只写空白 cell）
    if app.fx_enabled {
        app.fx.update(area);
        app.fx.render(frame.buffer_mut(), area);
    }
}

/// 品牌行：左 = 渐变 logo + 标语；右 = 项目名 + 呼吸状态点
fn render_brand(frame: &mut Frame, app: &App, area: Rect) {
    let narrow = area.width < layout::NARROW_WIDTH;

    let mut left: Vec<Span> = vec![Span::raw(" ")];
    left.extend(widgets::gradient_spans(
        "◤◢ Precis",
        colors::gradient_a(),
        colors::gradient_b(),
        true,
    ));
    if !narrow {
        left.push(Span::styled("  ·  本地数据校验工具", Style::default().fg(colors::dim())));
    }

    let connected = app.project_name.is_some();
    let mut right: Vec<Span> = Vec::new();
    if let Some(name) = &app.project_name {
        right.push(Span::styled(
            name.clone(),
            Style::default().fg(colors::fg()).add_modifier(Modifier::BOLD),
        ));
        right.push(Span::raw("  "));
    }
    // 状态点呼吸（连接时在 green↔dim 间脉动）
    let phase = (app.frame_count as f64 * 0.08).sin() * 0.5 + 0.5;
    let (glyph, dot, text) = if connected {
        (
            icons::status::CONNECTED,
            colors::blend(colors::green(), colors::dim(), phase * 0.6),
            " 已打开",
        )
    } else {
        (icons::status::DISCONNECTED, colors::dim(), " 未打开")
    };
    right.push(Span::styled(glyph, Style::default().fg(dot)));
    right.push(Span::styled(text, Style::default().fg(colors::muted())));
    right.push(Span::raw(" "));

    let left_line = Line::from(left);
    let right_line = Line::from(right);
    let gap = (area.width as usize)
        .saturating_sub(left_line.width() + right_line.width());
    let mut spans = left_line.spans;
    spans.push(Span::raw(" ".repeat(gap)));
    spans.extend(right_line.spans);
    frame.render_widget(Paragraph::new(Line::from(spans)), area);
}

/// 计算每个 tab 的显示区间（列偏移, 宽度），渲染与指示条共用同一几何
fn tab_rects(narrow: bool) -> [(usize, usize); 5] {
    let mut rects = [(0usize, 0usize); 5];
    let mut x = 0usize;
    for (i, tab) in Tab::all().iter().enumerate() {
        let label = if narrow { tab.short_label() } else { tab.label() };
        // 结构：空格 + 序号 + 图标+空格 + 标签 + 空格 = 5 + 标签宽
        let w = 5 + widgets::display_width(label);
        rects[i] = (x, w);
        x += w + 2; // tab 间距
    }
    rects
}

/// tab 栏：上行 = 标签（激活高亮）；下行 = 分隔线 + 滑动指示条
fn render_tabs(frame: &mut Frame, app: &App, area: Rect) {
    if area.height < 2 {
        return;
    }
    let narrow = area.width < layout::NARROW_WIDTH;
    let rects = tab_rects(narrow);

    // — tab 行 —
    let mut spans: Vec<Span> = Vec::new();
    for (i, tab) in Tab::all().iter().enumerate() {
        let active = *tab == app.current_tab;
        let accent = tab_accent(tab);
        let label = if narrow { tab.short_label() } else { tab.label() };
        let num = format!("{}", i + 1);
        if active {
            let base = Style::default().bg(colors::panel());
            spans.push(Span::styled(" ", base));
            spans.push(Span::styled(num, base.fg(colors::dim())));
            spans.push(Span::styled(
                format!("{} ", tab.icon()),
                base.fg(accent).add_modifier(Modifier::BOLD),
            ));
            spans.push(Span::styled(
                label.to_string(),
                base.fg(accent).add_modifier(Modifier::BOLD),
            ));
            spans.push(Span::styled(" ", base));
        } else {
            spans.push(Span::raw(" "));
            spans.push(Span::styled(num, Style::default().fg(colors::dim())));
            spans.push(Span::styled(
                format!("{} ", tab.icon()),
                Style::default().fg(colors::blend(accent, colors::bg(), 0.5)),
            ));
            spans.push(Span::styled(label.to_string(), Style::default().fg(colors::muted())));
            spans.push(Span::raw(" "));
        }
        spans.push(Span::raw("  "));
    }
    let tabs_row = Rect { height: 1, ..Rect { y: area.y, ..area } };
    frame.render_widget(Paragraph::new(Line::from(spans)), tabs_row);

    // — 指示条行：全宽分隔线 + 当前 tab 下的渐变粗指示段（滑动动画）—
    let (px, pw) = rects[app.prev_tab.index()];
    let (cx, cw) = rects[app.current_tab.index()];
    let t = ((app.frame_count.wrapping_sub(app.tab_switch_frame)) as f64
        / layout::TAB_ANIM_FRAMES as f64)
        .min(1.0);
    let e = 1.0 - (1.0 - t).powi(3); // ease-out cubic
    let ix = px as f64 + (cx as f64 - px as f64) * e;
    let iw = pw as f64 + (cw as f64 - pw as f64) * e;
    let x0 = ix.round() as usize;
    let x1 = (ix + iw).round().max(ix.round() + 1.0) as usize;

    let row_width = area.width as usize;
    let mut ind: Vec<Span> = Vec::with_capacity(row_width);
    for col in 0..row_width {
        if col >= x0 && col < x1 {
            let tc = if x1 > x0 { (col - x0) as f64 / (x1 - x0) as f64 } else { 0.0 };
            ind.push(Span::styled(
                icons::INDICATOR,
                Style::default().fg(colors::blend(colors::gradient_a(), colors::gradient_b(), tc)),
            ));
        } else {
            ind.push(Span::styled(icons::RULE, Style::default().fg(colors::border())));
        }
    }
    let ind_row = Rect { height: 1, ..Rect { y: area.y + 1, ..area } };
    frame.render_widget(Paragraph::new(Line::from(ind)), ind_row);
}

/// 状态栏：上行 = 状态消息（右端主题徽标）；下行 = 全局快捷键
fn render_footer(frame: &mut Frame, app: &App, area: Rect) {
    if area.height < 2 {
        return;
    }

    // — 状态行 —
    let busy = app.opening_project
        || matches!(app.validation, ValidationState::Validating)
        || app.chat_loading;
    let mut left: Vec<Span> = vec![Span::raw(" ")];
    if busy {
        left.push(Span::styled(
            icons::spinner(app.frame_count),
            Style::default().fg(colors::gradient_a()),
        ));
    } else {
        left.push(Span::styled(icons::status::CONNECTED, Style::default().fg(colors::dim())));
    }
    left.push(Span::raw(" "));
    left.push(Span::styled(app.message.clone(), Style::default().fg(colors::muted())));

    let motif = if colors::theme() == 1 { icons::motif::SNOW } else { icons::motif::SAKURA };
    let mut right: Vec<Span> = widgets::badge(
        &format!("{} {}", motif, colors::theme_name()),
        colors::gradient_a(),
    );
    if !app.fx_enabled {
        right.push(Span::styled(" fx:off", Style::default().fg(colors::dim())));
    }
    right.push(Span::raw(" "));

    let left_line = Line::from(left);
    let right_line = Line::from(right);
    let gap = (area.width as usize)
        .saturating_sub(left_line.width() + right_line.width());
    let mut spans = left_line.spans;
    spans.push(Span::raw(" ".repeat(gap)));
    spans.extend(right_line.spans);

    let status_row = Rect { height: 1, ..Rect { y: area.y, ..area } };
    frame.render_widget(Paragraph::new(Line::from(spans)), status_row);

    // — 快捷键行 —
    let hints = widgets::chips_line(&[
        ("Tab", "切换"),
        ("1-5", "直达"),
        ("F2", "动效"),
        ("F3", "主题"),
        ("q", "退出"),
    ]);
    let hints_row = Rect { height: 1, ..Rect { y: area.y + 1, ..area } };
    frame.render_widget(Paragraph::new(hints), hints_row);
}

/// 内容淡入：把区域内所有 cell 的前/背景色向 bg 混合 factor（0..1）
fn apply_fade(buf: &mut Buffer, area: Rect, factor: f64) {
    let bg = colors::bg();
    let x1 = (area.x.saturating_add(area.width)).min(buf.area.width);
    let y1 = (area.y.saturating_add(area.height)).min(buf.area.height);
    for y in area.y..y1 {
        for x in area.x..x1 {
            let idx = buf.index_of(x, y);
            let cell = &mut buf.content[idx];
            cell.fg = colors::blend(cell.fg, bg, factor);
            cell.bg = colors::blend(cell.bg, bg, factor);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::types::ProjectInfo;
    use ratatui::backend::TestBackend;
    use ratatui::Terminal;

    /// 渲染一帧并返回 buffer 文本（按行拼接，仅符号）
    fn render_to_string(app: &mut App, w: u16, h: u16) -> String {
        let backend = TestBackend::new(w, h);
        let mut terminal = Terminal::new(backend).unwrap();
        terminal.draw(|f| render(f, app)).unwrap();
        let buf = terminal.backend().buffer();
        let mut s = String::new();
        for y in 0..h {
            for x in 0..w {
                s.push_str(buf[(x, y)].symbol());
            }
        }
        s
    }

    fn running_app() -> App {
        let mut app = App::new("http://127.0.0.1:1");
        app.phase = Phase::Running;
        app.fx_enabled = false; // 粒子随机，关掉便于断言
        app
    }

    #[test]
    fn test_render_all_tabs_wide() {
        for tab in Tab::all() {
            let mut app = running_app();
            app.switch_tab(tab);
            let out = render_to_string(&mut app, 100, 30);
            assert!(out.contains("Precis"), "brand 缺失: {:?}", tab);
            assert!(out.contains(tab.label()), "tab 标签缺失: {:?}", tab);
            assert!(out.contains("切换"), "快捷键行缺失: {:?}", tab);
        }
    }

    #[test]
    fn test_render_all_tabs_narrow() {
        for tab in Tab::all() {
            let mut app = running_app();
            app.switch_tab(tab);
            let out = render_to_string(&mut app, 50, 20);
            assert!(out.contains("Precis"), "窄屏 brand 缺失: {:?}", tab);
            assert!(out.contains(tab.short_label()), "窄屏短标签缺失: {:?}", tab);
        }
    }

    #[test]
    fn test_render_splash_then_running() {
        let mut app = App::new("http://127.0.0.1:1");
        app.fx_enabled = false;
        let out = render_to_string(&mut app, 100, 30);
        assert!(!out.trim().is_empty(), "splash 应有内容");
        assert_eq!(app.splash_frame, 1);
    }

    #[test]
    fn test_dashboard_with_project() {
        let mut app = running_app();
        app.projects = vec![ProjectInfo {
            name: "demo".to_string(),
            path: "/tmp/demo".to_string(),
            schema_count: Some(3),
            constraint_count: Some(12),
            last_modified: None,
        }];
        app.project_name = Some("demo".to_string());
        let out = render_to_string(&mut app, 100, 30);
        assert!(out.contains("demo"), "项目名应显示");
        assert!(out.contains("项目"), "项目节标题应显示");
        assert!(out.contains("Schema"), "指标卡应显示");
    }

    #[test]
    fn test_dashboard_empty_projects() {
        let mut app = running_app();
        let out = render_to_string(&mut app, 100, 30);
        assert!(out.contains("项目"), "空列表也应有节标题");
        assert!(out.contains("本地数据校验工具"), "hero 标语应显示");
    }

    #[test]
    fn test_tab_switch_records_animation() {
        let mut app = running_app();
        assert_eq!(app.content_fade, 0);
        app.switch_tab(Tab::Validation);
        assert_eq!(app.prev_tab, Tab::Dashboard);
        assert_eq!(app.content_fade, layout::CONTENT_FADE_FRAMES);
        // 渲染不 panic（指示条处于动画中）
        let _ = render_to_string(&mut app, 100, 30);
    }
}
