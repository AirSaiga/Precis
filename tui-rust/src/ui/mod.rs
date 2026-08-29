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
use crate::i18n::pick;
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
    frame.render_widget(
        Block::default().style(Style::default().bg(colors::bg())),
        area,
    );

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
    // 主题装饰符（❀/❆）
    let motif = if colors::theme() == 1 {
        icons::motif::SNOW
    } else {
        icons::motif::SAKURA
    };
    left.push(Span::styled(
        format!(" {}", motif),
        Style::default().fg(colors::gradient_b()),
    ));
    if !narrow {
        left.push(Span::styled(
            format!(
                "  ·  {}",
                pick("本地数据校验工具", "Local data validation tool")
            ),
            Style::default().fg(colors::dim()),
        ));
    }

    let connected = app.project_name.is_some();
    let mut right: Vec<Span> = Vec::new();
    if let Some(name) = &app.project_name {
        right.push(Span::styled(
            name.clone(),
            Style::default()
                .fg(colors::fg())
                .add_modifier(Modifier::BOLD),
        ));
        right.push(Span::raw("  "));
    }
    // 状态点呼吸（连接时在 green↔dim 间脉动）
    let phase = (app.frame_count as f64 * 0.08).sin() * 0.5 + 0.5;
    let (glyph, dot, text) = if connected {
        (
            icons::status::CONNECTED,
            colors::blend(colors::green(), colors::dim(), phase * 0.6),
            format!(" {}", pick("已打开", "Opened")),
        )
    } else {
        (
            icons::status::DISCONNECTED,
            colors::dim(),
            format!(" {}", pick("未打开", "Not opened")),
        )
    };
    right.push(Span::styled(glyph, Style::default().fg(dot)));
    right.push(Span::styled(text, Style::default().fg(colors::muted())));
    right.push(Span::raw(" "));

    let left_line = Line::from(left);
    let right_line = Line::from(right);
    let gap = (area.width as usize).saturating_sub(left_line.width() + right_line.width());
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
        let label = if narrow {
            tab.short_label()
        } else {
            tab.label()
        };
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
        let label = if narrow {
            tab.short_label()
        } else {
            tab.label()
        };
        let num = format!("{}", i + 1);
        if active {
            // 反色 chip：主题色底 + 深色字，激活态一眼可辨
            let base = Style::default().bg(accent).fg(colors::bg());
            spans.push(Span::styled(" ", base));
            spans.push(Span::styled(num, base.add_modifier(Modifier::DIM)));
            spans.push(Span::styled(
                format!("{} ", tab.icon()),
                base.add_modifier(Modifier::BOLD),
            ));
            spans.push(Span::styled(
                label.to_string(),
                base.add_modifier(Modifier::BOLD),
            ));
            spans.push(Span::styled(" ", base));
        } else {
            spans.push(Span::raw(" "));
            spans.push(Span::styled(num, Style::default().fg(colors::dim())));
            spans.push(Span::styled(
                format!("{} ", tab.icon()),
                Style::default().fg(colors::blend(accent, colors::bg(), 0.5)),
            ));
            spans.push(Span::styled(
                label.to_string(),
                Style::default().fg(colors::muted()),
            ));
            spans.push(Span::raw(" "));
        }
        spans.push(Span::raw("  "));
    }
    let tabs_row = Rect {
        height: 1,
        ..Rect { y: area.y, ..area }
    };
    frame.render_widget(Paragraph::new(Line::from(spans)), tabs_row);

    // — 指示条行：全宽分隔线 + 当前 tab 下的渐变粗指示段（切换后原地淡入）—
    // 位置即时吸附当前 tab，不做滑动：cell 量化的短距滑动在终端里读不出平滑，
    // 只会跨骑相邻 chip 间隙（或回绕时横扫整条栏），与即时切换的 chip 高亮错位
    let (cx, cw) = rects[app.current_tab.index()];
    let fade_t = ((app.frame_count.wrapping_sub(app.tab_switch_frame)) as f64
        / layout::INDICATOR_FADE_FRAMES as f64)
        .min(1.0);
    // 起始向 bg 压暗 55%，数帧内淡入到全亮（保留切换的动态反馈）
    let dim_factor = (1.0 - fade_t) * 0.55;

    let (x0, x1) = (cx, cx + cw);
    let row_width = area.width as usize;
    let mut ind: Vec<Span> = Vec::with_capacity(row_width);
    for col in 0..row_width {
        if col >= x0 && col < x1 {
            let tc = if x1 > x0 {
                (col - x0) as f64 / (x1 - x0) as f64
            } else {
                0.0
            };
            let base = colors::blend(colors::gradient_a(), colors::gradient_b(), tc);
            ind.push(Span::styled(
                icons::INDICATOR,
                Style::default().fg(colors::blend(base, colors::bg(), dim_factor)),
            ));
        } else {
            ind.push(Span::styled(
                icons::RULE,
                Style::default().fg(colors::border()),
            ));
        }
    }
    let ind_row = Rect {
        height: 1,
        ..Rect {
            y: area.y + 1,
            ..area
        }
    };
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
        left.push(Span::styled(
            icons::status::CONNECTED,
            Style::default().fg(colors::dim()),
        ));
    }
    left.push(Span::raw(" "));
    left.push(Span::styled(
        app.message.clone(),
        Style::default().fg(message_color(&app.message)),
    ));

    let motif = if colors::theme() == 1 {
        icons::motif::SNOW
    } else {
        icons::motif::SAKURA
    };
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
    let gap = (area.width as usize).saturating_sub(left_line.width() + right_line.width());
    let mut spans = left_line.spans;
    spans.push(Span::raw(" ".repeat(gap)));
    spans.extend(right_line.spans);

    let status_row = Rect {
        height: 1,
        ..Rect { y: area.y, ..area }
    };
    frame.render_widget(Paragraph::new(Line::from(spans)), status_row);

    // — 快捷键行 —
    let hints = widgets::chips_line(&[
        ("Tab", pick("切换", "Switch")),
        ("1-5", pick("直达", "Go")),
        ("F2", pick("动效", "FX")),
        ("F3", pick("主题", "Theme")),
        ("q", pick("退出", "Quit")),
    ]);
    let hints_row = Rect {
        height: 1,
        ..Rect {
            y: area.y + 1,
            ..area
        }
    };
    frame.render_widget(Paragraph::new(hints), hints_row);
}

/// 状态消息按语义着色：错误红 / 成功绿 / 其余 muted
/// 关键词双语匹配：zh 按原文 contains，en 按小写化后 contains（保证英文界面下着色不失效）
fn message_color(msg: &str) -> Color {
    let lower = msg.to_lowercase();
    if msg.contains("失败")
        || msg.contains("错误")
        || msg.contains("未连接")
        || msg.contains("异常")
        || lower.contains("fail")
        || lower.contains("error")
        || lower.contains("not connected")
    {
        colors::red()
    } else if msg.contains("成功")
        || msg.contains("正常")
        || msg.contains("完成")
        || msg.contains("已连接")
        || msg.contains("已打开")
        || msg.contains("已激活")
        || msg.contains("找到")
        || lower.contains("success")
        || lower.contains("passed")
        || lower.contains("done")
        || lower.contains("connected")
        || lower.contains("opened")
        || lower.contains("activated")
        || lower.contains("found")
    {
        colors::green()
    } else {
        colors::muted()
    }
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
    use crate::api::types::{
        FullValidationResponse, ProjectInfo, ProviderInfo, ValidationErrorItem, ValidationSummary,
    };
    use crate::app::{ChatMsg, ProviderTestToast, TestResult};
    use ratatui::backend::TestBackend;
    use ratatui::Terminal;

    /// 渲染一帧并返回 buffer 文本（按行拼接；按符号显示宽度步进，跳过双宽字符的续格）
    fn render_to_string(app: &mut App, w: u16, h: u16) -> String {
        let backend = TestBackend::new(w, h);
        let mut terminal = Terminal::new(backend).unwrap();
        terminal.draw(|f| render(f, app)).unwrap();
        let buf = terminal.backend().buffer();
        let mut s = String::new();
        for y in 0..h {
            let mut x = 0;
            while x < w {
                let symbol = buf[(x, y)].symbol();
                s.push_str(symbol);
                x += widgets::display_width(symbol).max(1) as u16;
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
        // 指标卡绑定 api.project_path 的"已打开项目"，需与真实打开流程一致地设置
        app.api.set_project("/tmp/demo");
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

    /// 英文界面冒烟：切换 Lang 后渲染不 panic，tab 标签/标语切换为英文
    ///（thread_local 按测试线程隔离，结束后还原本线程语言）
    #[test]
    fn test_render_english_labels() {
        crate::i18n::set_lang(crate::i18n::Lang::EnUs);
        let mut app = running_app();
        app.switch_tab(Tab::Dashboard);
        let out = render_to_string(&mut app, 100, 30);
        crate::i18n::set_lang(crate::i18n::Lang::ZhCn);
        assert!(out.contains("Home"), "英文 tab 标签应渲染");
        assert!(out.contains("Local data validation tool"), "英文标语应渲染");
        assert!(out.contains("Projects"), "英文项目节标题应渲染");
    }

    /// 空项目列表按 backend_connected 分诊：未连接提示后端问题，已连接才提示目录问题
    #[test]
    fn dashboard_empty_shows_backend_guidance_when_disconnected() {
        // 默认 backend_connected=false 且 projects 空 → 指引排查后端连接
        let mut app = running_app();
        let out = render_to_string(&mut app, 100, 26);
        assert!(out.contains("后端未连接"), "未连接时应提示后端指引");
        assert!(!out.contains("未发现项目"), "未连接时不应误诊为目录问题");

        // 后端已连接但目录无项目 → 保持原有目录指引
        app.backend_connected = true;
        let out = render_to_string(&mut app, 100, 26);
        assert!(
            out.contains("未发现项目"),
            "已连接时空列表应提示 PRECIS_WORK_DIR"
        );
        assert!(!out.contains("后端未连接"), "已连接时不应再提示后端未连接");
    }

    #[test]
    fn test_config_with_realistic_coverage() {
        let mut app = running_app();
        app.switch_tab(Tab::Config);
        app.config_data = Some(crate::api::types::FullConfigResponse {
            manifest: serde_json::json!({
                "project": {"name": "demo", "id": "demo"},
                "schemas": [
                    {"id": "users", "path": "schemas/users.schema.yaml"},
                    {"id": "orders", "path": "schemas/orders.schema.yaml"}
                ],
                "constraints": [{"id": "c1", "path": "constraints/c1.constraint.yaml"}]
            }),
            schemas: serde_json::json!([]),
            constraints: serde_json::json!([]),
            coverage: Some(serde_json::json!({
                "is_complete": false,
                "unlisted": {
                    "schemas": [{"id": "legacy", "path": "schemas/legacy.schema.yaml"}],
                    "constraints": [], "regex_nodes": [], "transforms": [], "manual_data": []
                },
                "dangling": {
                    "schemas": [], "constraints": [{"id": "gone", "path": "constraints/gone.constraint.yaml"}],
                    "regex_nodes": [], "transforms": [], "manual_data": []
                }
            })),
        });
        let out = render_to_string(&mut app, 100, 30);
        assert!(out.contains("清单覆盖"), "覆盖区标题应显示");
        assert!(out.contains("未入清单"), "unlisted 分组应显示");
        assert!(out.contains("悬空引用"), "dangling 分组应显示");
        assert!(out.contains("legacy"), "unlisted id 应显示");
        assert!(!out.contains("\"constraints\":[]"), "不应显示原始 JSON");
    }

    #[test]
    fn test_provider_form_overlay() {
        let mut app = running_app();
        app.switch_tab(Tab::Provider);
        app.provider_form = Some(crate::app::ProviderForm::new());
        let out = render_to_string(&mut app, 100, 30);
        assert!(out.contains("新建 Provider"), "表单面板应显示");
        assert!(out.contains("openai"), "默认类型应显示");
        assert!(out.contains("Esc"), "表单提示应显示");
    }

    /// 渲染一帧并按行返回 buffer 文本（render_to_string 的按行版本，用于"同行"断言）
    fn render_lines(app: &mut App, w: u16, h: u16) -> Vec<String> {
        let backend = TestBackend::new(w, h);
        let mut terminal = Terminal::new(backend).unwrap();
        terminal.draw(|f| render(f, app)).unwrap();
        let buf = terminal.backend().buffer();
        let mut lines = Vec::new();
        for y in 0..h {
            let mut s = String::new();
            let mut x = 0;
            while x < w {
                let symbol = buf[(x, y)].symbol();
                s.push_str(symbol);
                x += widgets::display_width(symbol).max(1) as u16;
            }
            lines.push(s);
        }
        lines
    }

    /// Dashboard 指标卡应绑定"已打开项目"（api.project_path），而非光标选中的项目
    #[test]
    fn dashboard_metrics_follow_open_project_not_cursor() {
        let mut app = running_app();
        app.projects = vec![
            ProjectInfo {
                name: "qa_simple".to_string(),
                path: "p1".to_string(),
                schema_count: Some(2),
                constraint_count: Some(5),
                last_modified: None,
            },
            ProjectInfo {
                name: "other".to_string(),
                path: "p2".to_string(),
                schema_count: Some(8),
                constraint_count: Some(42),
                last_modified: None,
            },
        ];
        app.api.set_project("p1");
        app.project_name = Some("qa_simple".to_string());
        app.selected_project = 1; // 光标落在 other 上，指标卡仍应展示已打开的 p1
        let lines = render_lines(&mut app, 100, 30);
        // 名称行：● qa_simple  已打开   p1 应在同一行（brand 行无路径，列表行无"已打开"）
        assert!(
            lines
                .iter()
                .any(|l| l.contains("qa_simple") && l.contains("已打开") && l.contains("p1")),
            "名称行应绑定已打开项目而非光标项目"
        );
        // 指标卡数值行：2/5/7 应同出一行（卡片横排时三个数值共行），且不含光标项目的 42
        assert!(
            lines.iter().any(|l| l.contains("2")
                && l.contains("5")
                && l.contains("7")
                && !l.contains("42")),
            "指标卡数值应来自已打开项目（2/5/7）"
        );
        // 总计不应是光标项目的 8+42=50
        assert!(
            !lines.iter().any(|l| l.contains("50")),
            "总计不应显示光标项目的 8+42"
        );
    }

    /// 已打开项目不在扫描列表时：counts 不可得，跳过指标卡只渲染名称行（不 panic）
    #[test]
    fn dashboard_metrics_fallback_when_open_project_not_in_list() {
        let mut app = running_app();
        app.api.set_project("p9");
        app.project_name = Some("ext".to_string());
        let lines = render_lines(&mut app, 100, 30);
        assert!(
            lines
                .iter()
                .any(|l| l.contains("ext") && l.contains("已打开") && l.contains("p9")),
            "应渲染一行 名称 + 已打开 + 路径"
        );
        assert!(
            !lines.iter().any(|l| l.contains("Schema")),
            "counts 不可得时应跳过指标卡"
        );
    }

    #[test]
    fn test_tab_switch_records_animation() {
        let mut app = running_app();
        assert_eq!(app.content_fade, 0);
        app.switch_tab(Tab::Validation);
        assert_eq!(app.tab_switch_frame, app.frame_count);
        assert_eq!(app.content_fade, layout::CONTENT_FADE_FRAMES);
        // 渲染不 panic（指示条处于淡入中）
        let _ = render_to_string(&mut app, 100, 30);
    }

    /// 提取指示条行（y=2）的亮段区间（首列, 末列, 数量）
    fn indicator_bright_range(app: &mut App, w: u16, h: u16) -> (u16, u16, u16) {
        let backend = TestBackend::new(w, h);
        let mut terminal = Terminal::new(backend).unwrap();
        terminal.draw(|f| render(f, app)).unwrap();
        let buf = terminal.backend().buffer();
        let mut first: Option<u16> = None;
        let mut last = 0u16;
        let mut count = 0u16;
        for x in 0..w {
            if buf[(x, 2)].symbol() == icons::INDICATOR {
                if first.is_none() {
                    first = Some(x);
                }
                last = x;
                count += 1;
            }
        }
        (first.unwrap_or(0), last, count)
    }

    /// 回归：切换后第一帧指示条就必须完整吸附在当前 tab 矩形内（不再滑动跨骑相邻 chip）
    #[test]
    fn test_indicator_snaps_to_current_tab_immediately() {
        // 宽屏 tab 矩形：概览 = 37..46，AI 对话 = 48..60（由 tab_rects 几何决定）
        let mut app = running_app();
        app.switch_tab(Tab::Chat);
        // 切换后第一帧（淡入刚起步）：亮段必须已是当前 tab 的完整矩形
        let (first, last, count) = indicator_bright_range(&mut app, 100, 24);
        assert_eq!(
            (first, last, count),
            (48, 59, 12),
            "切换后首帧亮段应精确覆盖 Chat chip"
        );

        // 回绕切换同样即时吸附（原滑动实现会横扫整条栏 8 帧）
        app.switch_tab(Tab::Dashboard);
        let (first, last, count) = indicator_bright_range(&mut app, 100, 24);
        assert_eq!(
            (first, last, count),
            (0, 8, 9),
            "回绕后首帧亮段应精确覆盖 Dashboard chip"
        );
    }

    /// 回归：淡入保留——切换后首帧指示条被压暗，数帧后恢复到 gradient_a 全亮
    #[test]
    fn test_indicator_fades_in_in_place() {
        let mut app = running_app();
        app.switch_tab(Tab::Chat);
        // 首帧亮段首格颜色
        let first_frame_fg = {
            let backend = TestBackend::new(100, 24);
            let mut terminal = Terminal::new(backend).unwrap();
            terminal.draw(|f| render(f, &mut app)).unwrap();
            terminal.backend().buffer()[(48, 2)].fg
        };
        // 跑够淡入帧数后的颜色
        let mut settled_fg = first_frame_fg;
        for _ in 0..(layout::INDICATOR_FADE_FRAMES + 2) {
            let backend = TestBackend::new(100, 24);
            let mut terminal = Terminal::new(backend).unwrap();
            terminal.draw(|f| render(f, &mut app)).unwrap();
            settled_fg = terminal.backend().buffer()[(48, 2)].fg;
        }
        assert_ne!(first_frame_fg, colors::gradient_a(), "首帧应处于压暗态");
        assert_eq!(
            settled_fg,
            colors::gradient_a(),
            "淡入结束后应恢复到渐变起点全亮"
        );
    }

    /// 构造最小可渲染的 ProviderInfo（Provider 页 toast 测试用）
    fn make_provider(id: &str, name: &str) -> ProviderInfo {
        ProviderInfo {
            id: id.to_string(),
            name: name.to_string(),
            provider_type: "openai".to_string(),
            base_url: "http://127.0.0.1:1".to_string(),
            model: "demo-model".to_string(),
            context_window: None,
            health: None,
            is_configured: true,
        }
    }

    /// Chat 回看：scroll=0 显示最新消息且无标记；scroll>0 顶部出现回看标记并展示更早消息
    #[test]
    fn chat_scroll_shows_earlier_lines_and_marker() {
        let mut app = running_app();
        app.switch_tab(Tab::Chat);
        // 6 条长消息（每条约 59 个汉字，wrap 成 2 行），每条含唯一标记文本，
        // 总行数 6×4=24 > 可视高度 22，保证触发截断/回看切片
        for i in 1..=6 {
            let content = format!(
                "唯一标记第{:02}条{}",
                i,
                "这是一段用来撑高消息区的长对话内容".repeat(3)
            );
            app.chat_messages.push(ChatMsg {
                role: if i % 2 == 0 { "assistant" } else { "user" }.to_string(),
                content,
            });
        }

        // 默认停在最新消息：含最后一条内容、无回看标记
        let out = render_to_string(&mut app, 100, 30);
        assert!(
            out.contains("唯一标记第06条"),
            "tail 模式应显示最后一条消息"
        );
        assert!(!out.contains("回看"), "scroll=0 不应出现回看标记");

        // 回看 5 行：顶部出现回看标记，展示更早消息，最后一条移出可视区
        app.chat_scroll = 5;
        let out = render_to_string(&mut app, 100, 30);
        assert!(out.contains("回看"), "回看模式应显示回看标记");
        assert!(out.contains("PgDn"), "回看标记应提示 PgDn 返回");
        assert!(out.contains("唯一标记第01条"), "回看模式应显示更早的消息");
        assert!(
            !out.contains("唯一标记第06条"),
            "回看时最后一条消息应移出可视区"
        );
    }

    /// 回归：消息不足一屏时按 PgUp（chat_scroll>0 但无内容可滚）不占行不留空，
    /// 渲染与 scroll=0 完全一致（旧实现顶部会悬空一行且无回看标记）
    #[test]
    fn chat_scroll_no_marker_when_content_fits() {
        let mut app = running_app();
        app.switch_tab(Tab::Chat);
        // 2 条短消息远不足一屏
        for i in 1..=2 {
            app.chat_messages.push(ChatMsg {
                role: "user".to_string(),
                content: format!("短消息{}", i),
            });
        }
        let base = render_lines(&mut app, 100, 30);
        app.chat_scroll = 10; // 按了 PgUp，但内容不可滚
        let scrolled = render_lines(&mut app, 100, 30);
        assert!(
            !scrolled.iter().any(|l| l.contains("回看")),
            "内容不足一屏时不应出现回看标记"
        );
        assert_eq!(
            base, scrolled,
            "内容不足一屏时 PgUp 不应改变任何渲染（不留空行）"
        );
    }

    /// 校验错误超过渲染上限时表格底部应提示截断；未超限时无提示
    #[test]
    fn validation_errors_over_500_show_truncation_hint() {
        let make_resp = |n: i64| FullValidationResponse {
            success: false,
            summary: ValidationSummary {
                files_total: 3,
                files_loaded: 3,
                tables_loaded: 5,
                loading_error_count: 0,
                format_error_count: n as u32,
                constraint_error_count: 0,
                total_error_count: n as u32,
                duration_ms: 100,
                interrupted: false,
            },
            errors: (0..n)
                .map(|i| ValidationErrorItem {
                    stage: "format".to_string(),
                    error_type: "格式错误".to_string(),
                    message: format!("第 {} 条错误消息", i),
                    table: format!("表{}", i),
                    column: String::new(),
                    row_index: Some(i),
                    source_path: String::new(),
                })
                .collect(),
            statistics: None,
            error: None,
        };

        let mut app = running_app();
        app.switch_tab(Tab::Validation);
        app.validation = ValidationState::Done(Box::new(make_resp(501)));
        let out = render_to_string(&mut app, 100, 24);
        assert!(out.contains("仅显示前 500 条"), "超限时应提示截断");
        assert!(out.contains("501"), "提示应包含总错误数");

        let mut app = running_app();
        app.switch_tab(Tab::Validation);
        app.validation = ValidationState::Done(Box::new(make_resp(3)));
        let out = render_to_string(&mut app, 100, 24);
        assert!(!out.contains("仅显示"), "未超限时不应出现截断提示");
    }

    /// Provider 测试 toast 只在光标位于被测 provider 行时显示，光标移走即隐藏
    #[test]
    fn provider_toast_binds_tested_provider() {
        let mut app = running_app();
        app.switch_tab(Tab::Provider);
        app.providers = vec![make_provider("a", "Alpha"), make_provider("b", "Beta")];
        app.provider_cursor = 0;
        app.provider_test_result = Some(ProviderTestToast {
            provider_id: "a".to_string(),
            result: TestResult::Ok("ok".to_string()),
            at_frame: 0,
        });
        let out = render_to_string(&mut app, 100, 30);
        assert!(
            out.contains("连接正常"),
            "光标在被测 provider 行时应显示结果"
        );

        app.provider_cursor = 1;
        let out = render_to_string(&mut app, 100, 30);
        assert!(
            !out.contains("连接正常"),
            "光标移到其他 provider 行时不应张冠李戴"
        );
    }

    /// Provider 测试 toast 超过 TTL（约 5 秒 / 165 帧）后自动消隐
    #[test]
    fn provider_toast_expires_after_ttl() {
        let mut app = running_app();
        app.switch_tab(Tab::Provider);
        app.providers = vec![make_provider("a", "Alpha")];
        app.provider_cursor = 0;
        app.provider_test_result = Some(ProviderTestToast {
            provider_id: "a".to_string(),
            result: TestResult::Ok("ok".to_string()),
            at_frame: 0,
        });
        app.frame_count = 200; // 距产生时刻已远超 165 帧
        let out = render_to_string(&mut app, 100, 30);
        assert!(!out.contains("连接正常"), "超过 TTL 后 toast 应消隐");
    }
}
