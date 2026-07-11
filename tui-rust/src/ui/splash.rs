//! 启动画面（Splash）— 全屏 ASCII logo 扫光 + 版本号，约 1.5 秒

use ratatui::layout::{Alignment, Rect};
use ratatui::style::{Color, Modifier, Style};
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

/// 总帧数（约 1.5 秒 @ 33fps ≈ 45 帧，但用 18 帧做扫光 + 停留）
pub const SPLASH_FRAMES: usize = 18;

/// 渲染 splash 画面
pub fn render(frame: &mut Frame, splash_frame: usize, area: Rect) {
    // 深色全屏背景
    frame.render_widget(
        ratatui::widgets::Block::default().style(Style::default().bg(colors::BG)),
        area,
    );

    let progress = splash_frame as f64 / SPLASH_FRAMES as f64;
    let total_logo_lines = LOGO.len();
    let lit_lines = (progress * total_logo_lines as f64).ceil() as usize;

    let mut lines: Vec<Line> = Vec::new();

    // 顶部留白（居中）
    let top_pad = area.height.saturating_sub(total_logo_lines as u16 + 6) / 2;
    for _ in 0..top_pad {
        lines.push(Line::from(""));
    }

    // Logo 逐行扫光
    for (i, logo_line) in LOGO.iter().enumerate() {
        let color = if i < lit_lines {
            // 已点亮：从暗灰渐变到 PINK
            let t = (lit_lines as f64 - i as f64) / total_logo_lines as f64;
            let t = t.clamp(0.0, 1.0);
            blend_color(colors::DIM, colors::PINK, t)
        } else {
            colors::DIM
        };
        lines.push(Line::from(Span::styled(*logo_line, Style::default().fg(color))));
    }

    // 版本号 + 标语（logo 完全点亮后显示）
    lines.push(Line::from(""));
    if progress >= 0.8 {
        let fade = ((progress - 0.8) / 0.2).clamp(0.0, 1.0);
        let text_color = blend_color(colors::BG, colors::MUTED, fade);
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
        .style(Style::default().bg(colors::BG));
    frame.render_widget(splash, area);
}

/// 颜色混合（t=0 返回 a，t=1 返回 b）
fn blend_color(a: Color, b: Color, t: f64) -> Color {
    let t = t.clamp(0.0, 1.0);
    match (a, b) {
        (Color::Rgb(r1, g1, b1), Color::Rgb(r2, g2, b2)) => Color::Rgb(
            (r1 as f64 + (r2 as f64 - r1 as f64) * t) as u8,
            (g1 as f64 + (g2 as f64 - g1 as f64) * t) as u8,
            (b1 as f64 + (b2 as f64 - b1 as f64) * t) as u8,
        ),
        (_, c) => c,
    }
}
