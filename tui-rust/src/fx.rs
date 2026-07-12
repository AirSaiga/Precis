//! 动效系统：移动光场（moving light field）
//!
//! 不使用字符粒子。整个背景区域的颜色随时间和位置变化——
//! 一个柔和的光源在屏幕上缓慢移动（Lissajous 曲线），
//! 照亮经过的区域（背景色微微变亮、带主题色调），
//! 光源远离的区域保持深色。
//!
//! 周期性脉冲波纹从随机位置扩散，替代旧流星效果。

use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::Style;

use crate::app::colors;

/// 脉冲波纹（替代流星）
struct Pulse {
    x: f64,
    y: f64,
    age: f64,
    max_age: f64,
}

pub struct Fx {
    pulses: Vec<Pulse>,
    pulse_timer: f64,
    next_pulse: f64,
    /// 累计时间（秒），驱动光源运动
    elapsed: f64,
    last_frame: std::time::Instant,
}

impl Fx {
    pub fn new() -> Self {
        Self {
            pulses: Vec::new(),
            pulse_timer: 0.0,
            next_pulse: 5.0,
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

        // 脉冲触发
        self.pulse_timer += dt;
        if self.pulse_timer >= self.next_pulse {
            self.pulse_timer = 0.0;
            self.next_pulse = 4.0 + rand_val() * 5.0; // 4-9 秒
            let w = area.width as f64;
            let h = area.height as f64;
            self.pulses.push(Pulse {
                x: rand_val() * w,
                y: rand_val() * h,
                age: 0.0,
                max_age: 2.5 + rand_val() * 1.0, // 2.5-3.5 秒
            });
        }

        // 更新脉冲
        for p in &mut self.pulses {
            p.age += dt;
        }
        self.pulses.retain(|p| p.age < p.max_age);
    }

    /// 渲染：遍历空白 cell，按到光源距离计算背景色
    pub fn render(&self, buf: &mut Buffer, area: Rect) {
        let w = area.width as f64;
        let h = area.height as f64;
        if w < 1.0 || h < 1.0 {
            return;
        }

        let t = self.elapsed;

        // 主光源位置（Lissajous 曲线 — 平滑、永不重复的轨迹）
        let light_x = w * (0.5 + 0.35 * (t * 0.25).sin());
        let light_y = h * (0.5 + 0.30 * (t * 0.37 + 1.5).sin());

        // 光源颜色：樱花用粉色，飘雪用冰蓝
        let accent = if colors::theme() == 1 { colors::pink() } else { colors::pink() };

        let base_bg = colors::bg();
        let light_radius = 22.0; // 光照半径（cell）

        // 第二光源（较弱，反相位移动，增加层次）
        let light2_x = w * (0.5 + 0.40 * (t * 0.19 + 3.0).sin());
        let light2_y = h * (0.5 + 0.25 * (t * 0.31 + 0.7).sin());
        let accent2 = if colors::theme() == 1 {
            colors::cyan()
        } else {
            colors::cyan()
        };
        let light2_radius = 18.0;

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

                // 主光源贡献
                let dx1 = px - light_x;
                let dy1 = py - light_y;
                let dist1 = (dx1 * dx1 + dy1 * dy1).sqrt();
                let i1 = (1.0 - dist1 / light_radius).max(0.0);
                let i1 = i1 * i1; // 平方衰减

                // 第二光源贡献
                let dx2 = px - light2_x;
                let dy2 = py - light2_y;
                let dist2 = (dx2 * dx2 + dy2 * dy2).sqrt();
                let i2 = (1.0 - dist2 / light2_radius).max(0.0);
                let i2 = i2 * i2;

                // 脉冲波纹贡献
                let mut pulse_i: f64 = 0.0;
                for p in &self.pulses {
                    let pdx = px - p.x;
                    let pdy = py - p.y;
                    let pd = (pdx * pdx + pdy * pdy).sqrt();
                    let progress = p.age / p.max_age; // 0..1
                    let ring_radius = progress * 25.0; // 波纹扩散半径
                    let ring_width = 4.0;
                    // 距离波纹环越近，贡献越大
                    let dist_to_ring = (pd - ring_radius).abs();
                    if dist_to_ring < ring_width {
                        let ring_fade = 1.0 - progress; // 随时间消散
                        let ring_intensity = (1.0 - dist_to_ring / ring_width) * ring_fade;
                        pulse_i = pulse_i.max(ring_intensity * 0.15);
                    }
                }

                // 合成最终背景色
                let total_alpha = (i1 * 0.13 + i2 * 0.08 + pulse_i).min(0.2);

                if total_alpha > 0.005 {
                    // 先混合第二光源色，再混合主光源色
                    let bg1 = colors::blend(base_bg, accent2, i2 * 0.08);
                    let bg2 = colors::blend(bg1, accent, i1 * 0.13);
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
