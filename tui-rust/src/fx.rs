//! 动效系统：主题飘落粒子 + 弱化移动光场
//!
//! 粒子层（核心视觉）：
//! - 樱花主题飘落花瓣、飘雪主题飘落雪花，字符粒子从顶部生成、
//!   带正弦摇摆与全局微风下落，亮度随"景深"随机
//! - 只渲染到空白 cell，不遮挡任何内容
//!
//! 光场层（背景氛围，弱化）：
//! - 双 Lissajous 光源缓慢移动，微微照亮经过的空白区域
//! - 周期性脉冲波纹从随机位置扩散
//!
//! 渲染顺序（ui/mod.rs 调用）：先光场染色，再叠加粒子字形。

use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Color, Style};

use crate::app::colors;

/// 粒子字形集 — 仅装饰用途，不参与对齐
/// 个别终端对花形字符宽度渲染异常时，回退到下方保守集
const SAKURA_GLYPHS: &[&str] = &["✿", "❀", "∙", "'"];
const SNOW_GLYPHS: &[&str] = &["❄", "*", "·"];
#[allow(dead_code)]
const SAKURA_GLYPHS_SAFE: &[&str] = &["∙", "•", "'"];
#[allow(dead_code)]
const SNOW_GLYPHS_SAFE: &[&str] = &["*", "·", "∙"];

/// 飘落粒子
struct Particle {
    /// 摇摆中心列（cell，浮点）
    x: f64,
    /// 行（cell，浮点，可为负表示尚未进入屏幕）
    y: f64,
    /// 下落速度（行/秒）
    vy: f64,
    sway_phase: f64,
    sway_amp: f64,
    /// 字形索引（按当前主题字形集取模解析，主题切换即时生效）
    glyph_idx: usize,
    /// 与前景色的混合比例（0..0.4）
    mix: f64,
    /// 景深亮度（0.45..1.0）
    brightness: f64,
}

/// 脉冲波纹
struct Pulse {
    x: f64,
    y: f64,
    age: f64,
    max_age: f64,
}

pub struct Fx {
    particles: Vec<Particle>,
    pulses: Vec<Pulse>,
    pulse_timer: f64,
    next_pulse: f64,
    /// 累计时间（秒），驱动光源/摇摆/微风
    elapsed: f64,
    last_frame: std::time::Instant,
}

impl Fx {
    pub fn new() -> Self {
        Self {
            particles: Vec::new(),
            pulses: Vec::new(),
            pulse_timer: 0.0,
            next_pulse: 4.0,
            elapsed: 0.0,
            last_frame: std::time::Instant::now(),
        }
    }

    pub fn update(&mut self, area: Rect) {
        let now = std::time::Instant::now();
        let dt = now.duration_since(self.last_frame).as_secs_f64();
        self.last_frame = now;
        let dt = dt.min(0.1);

        self.elapsed += dt;

        let w = area.width as f64;
        let h = area.height as f64;
        if w < 1.0 || h < 1.0 {
            return;
        }

        // — 粒子：补足目标密度 —
        let target = ((w * h) / 400.0).clamp(8.0, 60.0) as usize;
        let snow = colors::theme() == 1;
        while self.particles.len() < target {
            // vy：樱花偏慢（2.0-5.0 行/秒）、雪花偏快（3.0-8.0 行/秒）
            let vy = if snow {
                3.0 + rand_val() * 5.0
            } else {
                2.0 + rand_val() * 3.0
            };
            self.particles.push(Particle {
                x: rand_val() * w,
                // 初始分布在屏幕上方一段距离内，避免开场整齐划一
                y: -rand_val() * h,
                vy,
                sway_phase: rand_val() * std::f64::consts::TAU,
                sway_amp: 0.5 + rand_val() * 1.5,
                glyph_idx: (rand_val() * 1000.0) as usize,
                mix: rand_val() * 0.4,
                brightness: 0.45 + rand_val() * 0.55,
            });
        }

        // — 粒子：下落 + 出界回收 —
        for p in &mut self.particles {
            p.y += p.vy * dt;
        }
        self.particles.retain(|p| p.y < h + 1.0);

        // — 脉冲：触发 —
        self.pulse_timer += dt;
        if self.pulse_timer >= self.next_pulse {
            self.pulse_timer = 0.0;
            self.next_pulse = 6.0 + rand_val() * 6.0; // 6-12 秒
            self.pulses.push(Pulse {
                x: rand_val() * w,
                y: rand_val() * h,
                age: 0.0,
                max_age: 2.5 + rand_val() * 1.0,
            });
        }
        for p in &mut self.pulses {
            p.age += dt;
        }
        self.pulses.retain(|p| p.age < p.max_age);
    }

    /// 渲染：先光场染色空白 cell，再叠加粒子字形
    pub fn render(&self, buf: &mut Buffer, area: Rect) {
        let w = area.width as f64;
        let h = area.height as f64;
        if w < 1.0 || h < 1.0 {
            return;
        }
        self.render_light_field(buf, area);
        self.render_particles(buf, area);
    }

    /// 光场层：双 Lissajous 光源 + 脉冲波纹（弱化版，只染空白 cell 背景）
    fn render_light_field(&self, buf: &mut Buffer, area: Rect) {
        let w = area.width as f64;
        let h = area.height as f64;
        let t = self.elapsed;

        // 主光源
        let light_x = w * (0.5 + 0.35 * (t * 0.25).sin());
        let light_y = h * (0.5 + 0.30 * (t * 0.37 + 1.5).sin());
        let accent = colors::gradient_a();
        let light_radius = 22.0;

        // 第二光源（较弱，反相位）
        let light2_x = w * (0.5 + 0.40 * (t * 0.19 + 3.0).sin());
        let light2_y = h * (0.5 + 0.25 * (t * 0.31 + 0.7).sin());
        let accent2 = colors::cyan();
        let light2_radius = 18.0;

        let base_bg = colors::bg();
        let buf_w = buf.area.width as usize;
        let buf_h = buf.area.height as usize;

        for y in 0..area.height {
            for x in 0..area.width {
                let abs_x = area.x + x;
                let abs_y = area.y + y;
                if abs_x as usize >= buf_w || abs_y as usize >= buf_h {
                    continue;
                }
                let idx = (abs_y as usize) * buf_w + (abs_x as usize);
                if idx >= buf.content.len() {
                    continue;
                }
                if buf.content[idx].symbol() != " " {
                    continue;
                }

                let px = x as f64;
                let py = y as f64;

                let dx1 = px - light_x;
                let dy1 = py - light_y;
                let i1 = (1.0 - (dx1 * dx1 + dy1 * dy1).sqrt() / light_radius).max(0.0);
                let i1 = i1 * i1;

                let dx2 = px - light2_x;
                let dy2 = py - light2_y;
                let i2 = (1.0 - (dx2 * dx2 + dy2 * dy2).sqrt() / light2_radius).max(0.0);
                let i2 = i2 * i2;

                let mut pulse_i: f64 = 0.0;
                for p in &self.pulses {
                    let pdx = px - p.x;
                    let pdy = py - p.y;
                    let pd = (pdx * pdx + pdy * pdy).sqrt();
                    let progress = p.age / p.max_age;
                    let ring_radius = progress * 25.0;
                    let ring_width = 4.0;
                    let dist_to_ring = (pd - ring_radius).abs();
                    if dist_to_ring < ring_width {
                        let ring_fade = 1.0 - progress;
                        pulse_i = pulse_i.max((1.0 - dist_to_ring / ring_width) * ring_fade * 0.06);
                    }
                }

                let total_alpha = (i1 * 0.05 + i2 * 0.035 + pulse_i).min(0.12);
                if total_alpha > 0.005 {
                    let bg1 = colors::blend(base_bg, accent2, i2 * 0.035);
                    let bg2 = colors::blend(bg1, accent, i1 * 0.05);
                    let final_bg = if pulse_i > 0.0 {
                        colors::blend(bg2, accent, pulse_i)
                    } else {
                        bg2
                    };
                    buf.content[idx].set_style(Style::default().bg(final_bg));
                }
            }
        }
    }

    /// 粒子层：在空白 cell 写入飘落字形（保留光场染的背景色）
    fn render_particles(&self, buf: &mut Buffer, area: Rect) {
        let snow = colors::theme() == 1;
        let glyphs = if snow { SNOW_GLYPHS } else { SAKURA_GLYPHS };
        let base = if snow { colors::cyan() } else { colors::pink() };
        // 全局微风（随时间缓慢转向）
        let wind = (self.elapsed * 0.1).sin() * 2.0;

        let buf_w = buf.area.width as usize;
        let buf_h = buf.area.height as usize;

        for p in &self.particles {
            if p.y < 0.0 {
                continue;
            }
            let px = p.x + (p.sway_phase + p.y * 0.15).sin() * p.sway_amp + wind;
            let cx = px.round() as i32;
            let cy = p.y.round() as i32;
            if cx < 0 || cy < 0 {
                continue;
            }
            let abs_x = area.x as i32 + cx;
            let abs_y = area.y as i32 + cy;
            if abs_x < 0 || abs_y < 0 || abs_x as usize >= buf_w || abs_y as usize >= buf_h {
                continue;
            }
            let idx = (abs_y as usize) * buf_w + (abs_x as usize);
            if idx >= buf.content.len() {
                continue;
            }
            // 不遮挡内容
            if buf.content[idx].symbol() != " " {
                continue;
            }
            let color: Color = colors::scale(colors::blend(base, colors::fg(), p.mix), p.brightness);
            let cell = &mut buf.content[idx];
            cell.set_symbol(glyphs[p.glyph_idx % glyphs.len()]);
            cell.set_fg(color);
        }
    }
}

fn rand_val() -> f64 {
    use std::cell::Cell;
    thread_local! {
        static STATE: Cell<u64> = Cell::new(0x4d595df4d0f33173);
    }
    STATE.with(|s| {
        let mut x = s.get();
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        s.set(x);
        (x >> 11) as f64 / (1u64 << 53) as f64
    })
}
