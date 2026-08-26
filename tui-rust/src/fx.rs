//! 动效系统：主题飘落粒子 + 弱化移动光场
//!
//! 粒子层（核心视觉）：
//! - 樱花主题飘落花瓣、飘雪主题飘落雪花，字符粒子从顶部生成、
//!   带正弦摇摆与全局微风下落
//! - 每颗粒子有一个"景深"值（0 远景 .. 1 近景），字形、亮度、下落速度、
//!   摆幅全部由景深派生——近景大而亮、快而摆，远景小而暗、慢而稳，
//!   三档字形读作同一朵雪的远近层次而非三种杂讯
//! - 只渲染到空白 cell，不遮挡任何内容；同帧相邻粒子互相让位，
//!   大花形（CJK 字体下常为双宽）额外要求右邻格空白，避免"❄·"糊成一团
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

/// 粒子字形集 — 按景深档位取用：[近景雪晶, 中景, 远景小点]
/// 雪晶字形（❅）比 ❄ 纤细，在 CJK 字体下观感更轻盈；仅装饰用途，不参与对齐
/// 个别终端对花形字符宽度渲染异常时，回退到下方保守集
const SAKURA_GLYPHS: &[&str] = &["✿", "❀", "∙"];
const SNOW_GLYPHS: &[&str] = &["❅", "*", "·"];
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
    /// 景深 0(远)..1(近) — 字形档位/亮度/速度/摆幅均由它派生
    depth: f64,
    /// 景深亮度 0.35..0.95（远景暗、近景亮）
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
        let target = ((w * h) / 260.0).clamp(10.0, 90.0) as usize;
        let snow = colors::theme() == 1;
        while self.particles.len() < target {
            // 景深决定一切外观：近景大花亮而快，远景小点暗而慢
            let depth = rand_val();
            // vy：樱花 2.0-5.0 行/秒、雪花略快 2.5-7.0 行/秒，近快远慢
            let vy = if snow {
                2.5 + depth * 4.5
            } else {
                2.0 + depth * 3.0
            };
            self.particles.push(Particle {
                x: rand_val() * w,
                // 初始分布在屏幕上方一段距离内，避免开场整齐划一
                y: -rand_val() * h,
                vy,
                sway_phase: rand_val() * std::f64::consts::TAU,
                sway_amp: 0.3 + depth * 1.4,
                depth,
                brightness: 0.35 + depth * 0.6,
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
                        pulse_i = pulse_i.max((1.0 - dist_to_ring / ring_width) * ring_fade * 0.09);
                    }
                }

                let total_alpha = (i1 * 0.09 + i2 * 0.06 + pulse_i).min(0.18);
                if total_alpha > 0.005 {
                    let bg1 = colors::blend(base_bg, accent2, i2 * 0.06);
                    let bg2 = colors::blend(bg1, accent, i1 * 0.09);
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
        // 粒子色相与主题渐变标题同源（樱花=粉、飘雪=品牌蓝），只按景深变亮度
        let base = colors::gradient_a();
        // 全局微风（随时间缓慢转向）
        let wind = (self.elapsed * 0.1).sin() * 2.0;

        let buf_w = buf.area.width as usize;
        let buf_h = buf.area.height as usize;
        // 本帧已落笔粒子的绝对坐标 — 防粘连：雪花大花形在 CJK 字体下常为双宽，
        // 会侵占右邻格，相邻粒子必须互相让位，否则糊成"❄·"
        let mut placed: Vec<(i32, i32)> = Vec::new();

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
            let tier = depth_tier(p.depth);
            // 双宽保险：右邻格在缓冲区内且有内容时整颗让位，避免字形压字
            if tier == 0 && (abs_x as usize + 1) < buf_w {
                let right = idx + 1;
                if right < buf.content.len() && buf.content[right].symbol() != " " {
                    continue;
                }
            }
            // 同帧防粘连：与本帧已落笔粒子同行且横向距离 ≤2 格则本帧跳过
            if placed
                .iter()
                .any(|&(py, px)| py == abs_y && (px - abs_x).abs() <= 2)
            {
                continue;
            }
            let color: Color = colors::scale(base, p.brightness);
            let cell = &mut buf.content[idx];
            cell.set_symbol(glyphs[tier]);
            cell.set_fg(color);
            placed.push((abs_y, abs_x));
        }
    }
}

/// 景深 → 字形档位：近景首字形（大花）、中景次字形、远景末字形（小点）
fn depth_tier(depth: f64) -> usize {
    if depth > 0.62 {
        0
    } else if depth > 0.30 {
        1
    } else {
        2
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

#[cfg(test)]
mod tests {
    use super::*;

    /// 造一颗指定位置的粒子（sway_amp=0、elapsed=0 时 wind 亦为 0，落点即 x/y 四舍五入）
    fn particle(x: f64, y: f64, depth: f64) -> Particle {
        Particle {
            x,
            y,
            vy: 1.0,
            sway_phase: 0.0,
            sway_amp: 0.0,
            depth,
            brightness: 0.9,
        }
    }

    #[test]
    fn depth_tier_maps_three_layers() {
        assert_eq!(depth_tier(0.9), 0);
        assert_eq!(depth_tier(0.5), 1);
        assert_eq!(depth_tier(0.1), 2);
    }

    #[test]
    fn glyph_sets_have_one_glyph_per_tier() {
        assert_eq!(SNOW_GLYPHS.len(), 3);
        assert_eq!(SAKURA_GLYPHS.len(), 3);
        assert_eq!(SNOW_GLYPHS_SAFE.len(), 3);
        assert_eq!(SAKURA_GLYPHS_SAFE.len(), 3);
    }

    #[test]
    fn particles_never_write_over_content() {
        let mut fx = Fx::new();
        fx.particles.push(particle(5.0, 5.0, 0.9));
        let area = Rect::new(0, 0, 20, 10);
        let mut buf = Buffer::empty(area);
        for cell in &mut buf.content {
            cell.set_symbol("X");
        }
        fx.render(&mut buf, area);
        assert!(buf.content.iter().all(|c| c.symbol() == "X"));
    }

    #[test]
    fn same_row_nearby_particles_do_not_fuse() {
        colors::set_theme(1); // 飘雪主题，近景字形为 ❄
        let mut fx = Fx::new();
        // 落点 (10,5) 与 (12,5)：同行横向距离 2 格，第二颗必须让位
        fx.particles.push(particle(10.4, 5.4, 0.9));
        fx.particles.push(particle(12.4, 5.4, 0.9));
        let area = Rect::new(0, 0, 40, 10);
        let mut buf = Buffer::empty(area);
        fx.render(&mut buf, area);
        assert_eq!(buf.content[5 * 40 + 10].symbol(), SNOW_GLYPHS[0]);
        assert_eq!(buf.content[5 * 40 + 12].symbol(), " ");
    }

    #[test]
    fn wide_glyph_yields_when_right_neighbor_has_content() {
        let mut fx = Fx::new();
        fx.particles.push(particle(10.0, 5.0, 0.9)); // 近景 ❄，CJK 字体下常为双宽
        let area = Rect::new(0, 0, 40, 10);
        let mut buf = Buffer::empty(area);
        buf.content[5 * 40 + 11].set_symbol("X"); // 右邻格有文字
        fx.render(&mut buf, area);
        assert_eq!(buf.content[5 * 40 + 10].symbol(), " ");
    }
}
