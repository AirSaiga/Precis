//! 启动画面（Splash）— 全屏 ASCII logo 三色渐变扫光 + 版本号，约 0.9 秒

use ratatui::layout::{Alignment, Rect};
use ratatui::style::Style;
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;
use ratatui::Frame;

use crate::app::colors;

/// ASCII art "PRECIS"（7 行，约 54 列）
const LOGO: &[&str] = &[
    r"████████  ████████  ████████  ██████  ████  ██████",
    r"██     ██ ██     ██ ██       ██    ██  ██  ██    ██",
    r"██     ██ ██     ██ ██       ██        ██  ██",
    r"████████  ████████  ██████   ██        ██   ██████",
    r"██        ██   ██   ██       ██        ██        ██",
    r"██        ██    ██  ██       ██    ██  ██  ██    ██",
    r"██        ██     ██ ████████  ██████  ████  ██████",
];

/// 总帧数（约 0.9 秒 @ 33fps，30 帧做扫光 + 停留）
pub const SPLASH_FRAMES: usize = 30;

/// 渲染 splash 画面
pub fn render(frame: &mut Frame, splash_frame: usize, area: Rect) {
    // 深色全屏背景
    frame.render_widget(
        ratatui::widgets::Block::default().style(Style::default().bg(colors::bg())),
        area,
    );

    let progress = splash_frame as f64 / SPLASH_FRAMES as f64;
    let total_logo_lines = LOGO.len();

    // 扫光带位置：从顶部滑到底部（前 60% 帧用于扫光，后 40% 停留）
    let sweep_progress = (progress / 0.6).clamp(0.0, 1.0);
    let sweep_line = (sweep_progress * total_logo_lines as f64) as usize;

    let mut lines: Vec<Line> = Vec::new();

    // 顶部留白（居中）
    let top_pad = area.height.saturating_sub(total_logo_lines as u16 + 6) / 2;
    for _ in 0..top_pad {
        lines.push(Line::from(""));
    }

    // Logo 逐行渐变扫光：粉→青→紫三段
    for (i, logo_line) in LOGO.iter().enumerate() {
        let color = if i < sweep_line {
            // 已扫过：按行号分三段渐变色
            let segment = i as f64 / total_logo_lines as f64;
            if segment < 0.33 {
                colors::pink()
            } else if segment < 0.67 {
                colors::cyan()
            } else {
                colors::purple()
            }
        } else if i == sweep_line {
            // 当前扫光带：亮白过渡色
            colors::blend(colors::fg(), colors::pink(), 0.5)
        } else {
            colors::dim()
        };
        lines.push(Line::from(Span::styled(*logo_line, Style::default().fg(color))));
    }

    // 版本号 + 标语（logo 全部点亮后淡入）
    lines.push(Line::from(""));
    if progress >= 0.6 {
        let fade = ((progress - 0.6) / 0.4).clamp(0.0, 1.0);
        let text_color = colors::blend(colors::bg(), colors::muted(), fade);
        lines.push(Line::from(Span::styled(
            "v0.1.0",
            Style::default().fg(text_color),
        )));
        lines.push(Line::from(Span::styled(
            "本地数据校验工具",
            Style::default().fg(text_color),
        )));
    }

    let splash = Paragraph::new(lines)
        .alignment(Alignment::Center)
        .style(Style::default().bg(colors::bg()));
    frame.render_widget(splash, area);
}
