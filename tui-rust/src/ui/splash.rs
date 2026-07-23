//! 启动画面（Splash）— 全屏 ASCII logo 横向渐变 + 扫光带 + 版本淡入 + 末尾淡出，约 0.9 秒

use ratatui::layout::{Alignment, Rect};
use ratatui::style::Style;
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;
use ratatui::Frame;

use crate::app::colors;

/// ASCII art "PRECIS"（7 行，约 54 列）
pub(crate) const LOGO: &[&str] = &[
    r"████████  ████████  ████████  ██████  ████  ██████",
    r"██     ██ ██     ██ ██       ██    ██  ██  ██    ██",
    r"██     ██ ██     ██ ██       ██        ██  ██",
    r"████████  ████████  ██████   ██        ██   ██████",
    r"██        ██   ██   ██       ██        ██        ██",
    r"██        ██    ██  ██       ██    ██  ██  ██    ██",
    r"██        ██     ██ ████████  ██████  ████  ██████",
];

/// 总帧数（约 0.9 秒 @ 33fps）
pub const SPLASH_FRAMES: usize = 30;

/// 渲染 splash 画面
pub fn render(frame: &mut Frame, splash_frame: usize, area: Rect) {
    // 深色全屏背景
    frame.render_widget(
        ratatui::widgets::Block::default().style(Style::default().bg(colors::bg())),
        area,
    );

    let progress = splash_frame as f64 / SPLASH_FRAMES as f64;
    let logo_w = LOGO.iter().map(|l| l.chars().count()).max().unwrap_or(1) as f64;

    // 扫光带横向位置：前 70% 帧从左扫到右（带心坐标，含越界缓冲）
    let sweep_t = (progress / 0.7).clamp(0.0, 1.0);
    let band_x = sweep_t * (logo_w + 16.0) - 8.0;
    const BAND_HALF: f64 = 5.0;

    // 末尾 15% 帧整体向 bg 淡出
    let fade = if progress > 0.85 {
        ((progress - 0.85) / 0.15).clamp(0.0, 1.0)
    } else {
        0.0
    };

    let mut lines: Vec<Line> = Vec::new();

    // 顶部留白（垂直居中）
    let top_pad = area.height.saturating_sub(LOGO.len() as u16 + 6) / 2;
    for _ in 0..top_pad {
        lines.push(Line::from(""));
    }

    // Logo：逐字符横向渐变（gradient_a→gradient_b），扫光带高亮、未扫到处暗化
    let a = colors::gradient_a();
    let b = colors::gradient_b();
    for logo_line in LOGO {
        let spans: Vec<Span> = logo_line
            .chars()
            .enumerate()
            .map(|(i, c)| {
                let base = colors::blend(a, b, i as f64 / (logo_w - 1.0).max(1.0));
                let d = i as f64 - band_x;
                let lit = if d < -BAND_HALF {
                    base // 已扫过：完整渐变
                } else if d <= BAND_HALF {
                    // 扫光带内：向 fg 提亮（中心最亮）
                    let boost = 1.0 - d.abs() / BAND_HALF;
                    colors::blend(base, colors::fg(), 0.4 + 0.4 * boost)
                } else {
                    // 未扫到：暗化
                    colors::blend(base, colors::bg(), 0.8)
                };
                let color = if fade > 0.0 { colors::blend(lit, colors::bg(), fade) } else { lit };
                Span::styled(c.to_string(), Style::default().fg(color))
            })
            .collect();
        lines.push(Line::from(spans));
    }

    // 版本号 + 标语（60% 后淡入，末尾随全屏淡出）
    lines.push(Line::from(""));
    if progress >= 0.6 {
        let fade_in = ((progress - 0.6) / 0.25).clamp(0.0, 1.0);
        let mut text_color = colors::blend(colors::bg(), colors::muted(), fade_in);
        if fade > 0.0 {
            text_color = colors::blend(text_color, colors::bg(), fade);
        }
        lines.push(Line::from(Span::styled("v0.1.0", Style::default().fg(text_color))));
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
