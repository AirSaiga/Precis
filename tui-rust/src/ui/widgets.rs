//! 共享 UI 组件库 — 各页面统一的面板 / 标题 / chip / 进度条 / 卡片 / 徽标 / 渐变文字
//!
//! 约定：
//! - 所有颜色取自 `app::colors`（双主题），不硬编码 `Color::Rgb`
//! - 返回 `Line`/`Span` 的组件用 `'static`（内部 own 字符串），调用点直接组装

use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, BorderType, Borders, Paragraph};
use ratatui::Frame;

use crate::app::colors;
use crate::icons;

/// 圆角面板（顶部标题 + 专用边框色）
pub fn panel(title: &str, accent: Color) -> Block<'static> {
    Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(Style::default().fg(colors::border()))
        .title(Span::styled(
            format!(" {} ", title),
            Style::default().fg(accent).add_modifier(Modifier::BOLD),
        ))
        .style(Style::default().bg(colors::bg()))
}

/// 节标题行：` ◈ 标题 (N) ────────────`（分隔线填充到 width）
pub fn section_header(icon: &str, title: &str, count: Option<usize>, width: usize) -> Line<'static> {
    let count_txt = count.map(|c| format!(" ({})", c)).unwrap_or_default();
    // 显示宽度估算：ASCII 1 宽、CJK 2 宽
    let used = display_width(icon) + display_width(title) + display_width(&count_txt) + 3;
    let fill = width.saturating_sub(used);
    Line::from(vec![
        Span::raw(" "),
        Span::styled(icon.to_string(), Style::default().fg(colors::gradient_a())),
        Span::styled(
            format!(" {} ", title),
            Style::default().fg(colors::fg()).add_modifier(Modifier::BOLD),
        ),
        Span::styled(count_txt, Style::default().fg(colors::dim())),
        Span::raw(" "),
        Span::styled(icons::divider(fill), Style::default().fg(colors::border())),
    ])
}

/// 快捷键 chip：`key`（亮色加粗）+ `desc`（dim）
pub fn keychip(key: &str, desc: &str) -> Vec<Span<'static>> {
    vec![
        Span::styled(
            format!(" {} ", key),
            Style::default().fg(colors::gradient_a()).add_modifier(Modifier::BOLD),
        ),
        Span::styled(desc.to_string(), Style::default().fg(colors::dim())),
    ]
}

/// 把多组 chip 用 dim 分隔点连接成一行
pub fn chips_line(groups: &[(&str, &str)]) -> Line<'static> {
    let mut spans = vec![Span::raw(" ")];
    for (i, (key, desc)) in groups.iter().enumerate() {
        if i > 0 {
            spans.push(Span::styled("  ·  ", Style::default().fg(colors::dim())));
        }
        spans.extend(keychip(key, desc));
    }
    Line::from(spans)
}

/// 渐变进度条：已填充段 gradient_a→gradient_b 逐列插值（`━`），未填充段 boost（`─`）
pub fn meter(ratio: f64, width: usize) -> Vec<Span<'static>> {
    let ratio = ratio.clamp(0.0, 1.0);
    let filled = (ratio * width as f64).round() as usize;
    let mut spans = Vec::with_capacity(width.max(1));
    for i in 0..filled {
        let t = if width > 1 { i as f64 / (width - 1) as f64 } else { 0.0 };
        spans.push(Span::styled(
            "━",
            Style::default().fg(colors::blend(colors::gradient_a(), colors::gradient_b(), t)),
        ));
    }
    for _ in filled..width {
        spans.push(Span::styled("─", Style::default().fg(colors::boost())));
    }
    spans
}

/// 指标小卡：圆角边框 + 大号呼吸数字 + muted 标签（phase 0..1 驱动呼吸）
pub fn stat_card(frame: &mut Frame, area: Rect, value: &str, label: &str, accent: Color, phase: f64) {
    let block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(Style::default().fg(colors::border()))
        .style(Style::default().bg(colors::bg()));
    let inner = block.inner(area);
    frame.render_widget(block, area);
    if inner.height == 0 || inner.width == 0 {
        return;
    }
    let num_color = colors::blend(accent, colors::fg(), phase * 0.35);
    let lines = vec![
        Line::from(Span::styled(
            format!(" {}", value),
            Style::default().fg(num_color).add_modifier(Modifier::BOLD),
        )),
        Line::from(Span::styled(
            format!(" {}", label),
            Style::default().fg(colors::muted()),
        )),
    ];
    frame.render_widget(Paragraph::new(lines).style(Style::default().bg(colors::bg())), inner);
}

/// 状态徽标：`[ 文本 ]`（括号 dim，文本彩色）
pub fn badge(text: &str, color: Color) -> Vec<Span<'static>> {
    vec![
        Span::styled("[", Style::default().fg(colors::dim())),
        Span::styled(text.to_string(), Style::default().fg(color)),
        Span::styled("]", Style::default().fg(colors::dim())),
    ]
}

/// 渐变文字：逐字符在 a→b 间插值
pub fn gradient_spans(text: &str, a: Color, b: Color, bold: bool) -> Vec<Span<'static>> {
    let chars: Vec<char> = text.chars().collect();
    let n = chars.len();
    chars
        .into_iter()
        .enumerate()
        .map(|(i, c)| {
            let t = if n > 1 { i as f64 / (n - 1) as f64 } else { 0.0 };
            let style = if bold {
                Style::default().fg(colors::blend(a, b, t)).add_modifier(Modifier::BOLD)
            } else {
                Style::default().fg(colors::blend(a, b, t))
            };
            Span::styled(c.to_string(), style)
        })
        .collect()
}

/// 显示宽度估算：ASCII 1 宽、其余（CJK 等）2 宽
pub fn display_width(s: &str) -> usize {
    s.chars().map(|c| if c.is_ascii() { 1 } else { 2 }).sum()
}

/// 手动换行：按显示宽度把长文本切成多行（修复长消息溢出，替代 Wrap 的不可控滚动）
pub fn wrap_text(s: &str, width: usize) -> Vec<String> {
    if width == 0 {
        return vec![s.to_string()];
    }
    let mut lines = Vec::new();
    let mut cur = String::new();
    let mut cur_w = 0usize;
    for c in s.chars() {
        let cw = if c.is_ascii() { 1 } else { 2 };
        if c == '\n' {
            lines.push(std::mem::take(&mut cur));
            cur_w = 0;
            continue;
        }
        if cur_w + cw > width && !cur.is_empty() {
            lines.push(std::mem::take(&mut cur));
            cur_w = 0;
        }
        cur.push(c);
        cur_w += cw;
    }
    lines.push(cur);
    lines
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_display_width() {
        assert_eq!(display_width("abc"), 3);
        assert_eq!(display_width("首页"), 4);
        assert_eq!(display_width("a首"), 3);
    }

    #[test]
    fn test_wrap_text_short() {
        assert_eq!(wrap_text("hello", 10), vec!["hello"]);
    }

    #[test]
    fn test_wrap_text_breaks_at_width() {
        let lines = wrap_text("hello world", 5);
        assert_eq!(lines, vec!["hello", " worl", "d"]);
    }

    #[test]
    fn test_wrap_text_cjk() {
        // 4 个 CJK = 8 宽，width=5 → 每行 2 字（4 宽）
        let lines = wrap_text("首页校验", 5);
        assert_eq!(lines, vec!["首页", "校验"]);
    }

    #[test]
    fn test_wrap_text_newline() {
        assert_eq!(wrap_text("ab\ncd", 10), vec!["ab", "cd"]);
    }

    #[test]
    fn test_meter_lengths() {
        assert_eq!(meter(0.5, 10).len(), 10);
        assert_eq!(meter(1.5, 6).len(), 6);
        assert_eq!(meter(0.0, 0).len(), 0);
    }
}
