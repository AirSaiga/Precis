//! 动效系统：双主题常驻粒子（樱花星光 / 飘雪纷飞）
//!
//! 樱花主题：常驻密集星光（三色、多字符层次）+ 频繁流星。
//! 飘雪主题：常驻雪纷飞（两色、多字符层次、摇摆飘落）+ 偶尔大雪片。
//! 所有字符均为单宽，避免双宽字符破坏终端对齐。

use std::time::Instant;

use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};

use crate::app::colors;

/// 粒子颜色种类
#[derive(Clone, Copy)]
enum ParticleColor {
    Primary,
    Secondary,
    Purple,
}

/// 单个粒子
#[derive(Clone)]
struct Particle {
    x: f64,
    y: f64,
    vx: f64,
    vy: f64,
    brightness: f64,
    twinkle_phase: f64,
    twinkle_speed: f64,
    sway_phase: f64,
    sway_speed: f64,
    sway_amplitude: f64,
    char: char,
    /// 字符大小层级（影响是否加 BOLD）
    size: u8,
    color: ParticleColor,
}

/// 流星 / 大雪片
struct MeteorState {
    x: f64,
    y: f64,
    vx: f64,
    vy: f64,
    trail: Vec<(i32, i32)>,
    age: f64,
    max_age: f64,
    alive: bool,
    color: ParticleColor,
}

pub struct Fx {
    particles: Vec<Particle>,
    meteors: Vec<MeteorState>,
    last_frame: Instant,
    meteor_timer: f64,
    next_meteor: f64,
}

impl Fx {
    pub fn new() -> Self {
        Self {
            particles: Vec::new(),
            meteors: Vec::new(),
            last_frame: Instant::now(),
            meteor_timer: 0.0,
            next_meteor: 2.0,
        }
    }

    pub fn update(&mut self, area: Rect) {
        let now = Instant::now();
        let dt = now.duration_since(self.last_frame).as_secs_f64();
        self.last_frame = now;
        let dt = dt.min(0.1);

        let w = area.width as f64;
        let h = area.height as f64;
        if w < 1.0 || h < 1.0 {
            return;
        }

        let is_snow = colors::theme() == 1;

        // ===== 常驻粒子密度 =====
        // 樱花：1/120 cell（密集星光），上限 120
        // 飘雪：1/100 cell（雪纷飞），上限 120
        let divisor = if is_snow { 100.0 } else { 120.0 };
        let target = ((w * h) / divisor) as usize;
        let target = target.min(120);
        while self.particles.len() < target {
            self.particles.push(spawn_particle(w, h, true));
        }

        for p in &mut self.particles {
            p.twinkle_phase += p.twinkle_speed * dt;
            p.sway_phase += p.sway_speed * dt;

            if is_snow {
                // 飘雪：垂直下落 + 摇摆
                p.y += p.vy * dt;
                p.x += p.sway_phase.sin() * p.sway_amplitude * dt;
                if p.y > h + 2.0 || p.x < -3.0 || p.x > w + 3.0 {
                    *p = spawn_particle(w, h, false);
                }
            } else {
                // 樱花：斜向缓慢飘动
                p.x += p.vx * dt;
                p.y += p.vy * dt;
                if p.x < -3.0 || p.y > h + 3.0 {
                    *p = spawn_particle(w, h, false);
                }
            }
        }

        // ===== 流星 / 大雪片触发 =====
        self.meteor_timer += dt;
        if self.meteor_timer >= self.next_meteor {
            self.meteor_timer = 0.0;
            if is_snow {
                // 飘雪：偶尔大雪片（4-8秒）
                self.next_meteor = 4.0 + rand_val() * 4.0;
            } else {
                // 樱花：频繁流星（1.5-4秒）
                self.next_meteor = 1.5 + rand_val() * 2.5;
            }
            self.spawn_meteor(w, h);
        }

        // 更新流星
        for m in &mut self.meteors {
            m.x += m.vx * dt;
            m.y += m.vy * dt;
            m.age += dt;
            m.trail.insert(0, (m.x as i32, m.y as i32));
            let max_trail = if is_snow { 5 } else { 14 };
            if m.trail.len() > max_trail {
                m.trail.pop();
            }
            if m.x < -8.0 || m.y > h + 8.0 || m.x > w + 8.0 || m.y < -8.0 {
                m.alive = false;
            }
        }
        self.meteors.retain(|m| m.alive);
    }

    fn spawn_meteor(&mut self, w: f64, _h: f64) {
        if colors::theme() == 1 {
            // 飘雪：大雪片垂直下落 + 轻微偏移 + 短拖尾
            let speed = 5.0 + rand_val() * 4.0;
            let start_x = rand_val() * w;
            self.meteors.push(MeteorState {
                x: start_x,
                y: -1.0,
                vx: (rand_val() - 0.5) * 2.5,
                vy: speed,
                trail: Vec::new(),
                age: 0.0,
                max_age: 5.0,
                alive: true,
                color: if rand_val() < 0.6 { ParticleColor::Primary } else { ParticleColor::Secondary },
            });
        } else {
            // 樱花：流星斜向 + 长拖尾
            let angle = (15.0 + rand_val() * 40.0).to_radians();
            let speed = 18.0 + rand_val() * 12.0;
            let start_x = w * (0.3 + rand_val() * 0.7);
            let color = match rand_val() {
                r if r < 0.4 => ParticleColor::Primary,
                r if r < 0.75 => ParticleColor::Secondary,
                _ => ParticleColor::Purple,
            };
            self.meteors.push(MeteorState {
                x: start_x,
                y: -1.0,
                vx: -angle.cos() * speed,
                vy: angle.sin() * speed,
                trail: Vec::new(),
                age: 0.0,
                max_age: 2.5,
                alive: true,
                color,
            });
        }
    }

    /// 渲染到 Buffer（只覆盖空白 cell）
    pub fn render(&self, buf: &mut Buffer, area: Rect) {
        let is_snow = colors::theme() == 1;

        // ===== 粒子 =====
        for p in &self.particles {
            let x = p.x as i32 as u16;
            let y = p.y as u16;
            if x >= area.width || y >= area.height {
                continue;
            }
            let abs_x = area.x + x;
            let abs_y = area.y + y;
            if abs_x >= buf.area.width || abs_y >= buf.area.height {
                continue;
            }
            let twinkle = (p.twinkle_phase.sin() + 1.0) * 0.5;
            let brightness = p.brightness * (0.2 + 0.8 * twinkle);
            let base = match p.color {
                ParticleColor::Primary => colors::pink(),
                ParticleColor::Secondary => colors::cyan(),
                ParticleColor::Purple => colors::purple(),
            };
            let color = colors::scale(base, brightness);
            let idx = (abs_y as usize) * (buf.area.width as usize) + (abs_x as usize);
            if idx < buf.content.len() {
                let cell = &mut buf.content[idx];
                if cell.symbol() == " " {
                    cell.set_char(p.char);
                    if p.size >= 2 {
                        cell.set_style(Style::default().fg(color).add_modifier(Modifier::BOLD));
                    } else {
                        cell.set_style(Style::default().fg(color));
                    }
                }
            }
        }

        // ===== 流星 / 大雪片拖尾 =====
        for m in &self.meteors {
            let life_fade = if m.age > m.max_age - 0.5 {
                ((m.max_age - m.age) / 0.5).max(0.0)
            } else {
                1.0
            };
            let base = match m.color {
                ParticleColor::Primary => colors::pink(),
                ParticleColor::Secondary => colors::cyan(),
                ParticleColor::Purple => colors::purple(),
            };

            for (i, &(tx, ty)) in m.trail.iter().enumerate() {
                if tx < 0 || ty < 0 {
                    continue;
                }
                let abs_x = area.x + tx as u16;
                let abs_y = area.y + ty as u16;
                if abs_x >= buf.area.width || abs_y >= buf.area.height {
                    continue;
                }
                let trail_fade = (1.0 - (i as f64 / m.trail.len() as f64)) * life_fade;
                let (char, max_idx) = if is_snow {
                    // 飘雪大雪片：头 *，中 ·，尾 .
                    if i == 0 { ('*', 4) } else if i < 2 { ('·', 4) } else { ('.', 4) }
                } else {
                    // 樱花流星：头 ✦，中 •，尾 ·
                    if i == 0 { ('\u{2726}', 7) } else if i < 3 { ('\u{2022}', 7) } else { ('\u{00b7}', 7) }
                };
                if i >= max_idx {
                    continue;
                }
                let color = colors::scale(base, trail_fade.max(0.15));
                let idx = (abs_y as usize) * (buf.area.width as usize) + (abs_x as usize);
                if idx < buf.content.len() {
                    let cell = &mut buf.content[idx];
                    if cell.symbol() == " " {
                        cell.set_char(char);
                        cell.set_style(Style::default().fg(color).add_modifier(Modifier::BOLD));
                    }
                }
            }
        }
    }
}

fn spawn_particle(w: f64, h: f64, initial: bool) -> Particle {
    if colors::theme() == 1 {
        spawn_snowflake(w, h, initial)
    } else {
        spawn_star(w, h, initial)
    }
}

/// 樱花主题星光：斜向缓慢飘动，三色，多字符层次
fn spawn_star(w: f64, h: f64, initial: bool) -> Particle {
    let angle = (200.0 + rand_val() * 60.0).to_radians();
    let speed = 2.0 + rand_val() * 4.0;
    let (x, y) = if initial {
        (rand_val() * w, rand_val() * h)
    } else {
        if rand_val() < 0.5 {
            (w + 1.0, rand_val() * h)
        } else {
            (rand_val() * w, -1.0)
        }
    };
    let r = rand_val();
    let color = if r < 0.4 {
        ParticleColor::Primary
    } else if r < 0.75 {
        ParticleColor::Secondary
    } else {
        ParticleColor::Purple
    };
    // 多字符层次：大星 ✦(5%) 中 •(15%) 小 ·(50%) 极小 .(30%)
    let cr = rand_val();
    let (char, size) = if cr < 0.05 {
        ('\u{2726}', 2) // ✦ 四角星（大，BOLD）
    } else if cr < 0.20 {
        ('\u{2022}', 1) // • 圆点（中）
    } else if cr < 0.70 {
        ('\u{00b7}', 0) // · 中心点（小）
    } else {
        ('\u{002e}', 0) // . 句点（极小）
    };
    Particle {
        x, y,
        vx: -angle.cos() * speed,
        vy: angle.sin() * speed,
        brightness: 0.1 + rand_val() * 0.4, // 0.1-0.5
        twinkle_phase: rand_val() * std::f64::consts::TAU,
        twinkle_speed: 0.5 + rand_val() * 2.0, // 较快闪烁
        sway_phase: 0.0, sway_speed: 0.0, sway_amplitude: 0.0,
        char, size, color,
    }
}

/// 飘雪主题雪花：垂直下落 + 摇摆，两色，多字符层次
fn spawn_snowflake(w: f64, h: f64, initial: bool) -> Particle {
    let speed = 1.0 + rand_val() * 3.0; // 1-4 cell/秒，缓慢
    let (x, y) = if initial {
        (rand_val() * w, rand_val() * h)
    } else {
        (rand_val() * w, -1.0)
    };
    let color = if rand_val() < 0.6 {
        ParticleColor::Primary // 冰蓝 60%
    } else {
        ParticleColor::Secondary // 月白 40%
    };
    // 多字符层次：大雪 ❅(5%) 中雪 *(15%) 小雪 ·(50%) 碎雪 .(30%)
    let cr = rand_val();
    let (char, size) = if cr < 0.05 {
        ('\u{2745}', 2) // ❅ 雪花（大，BOLD）
    } else if cr < 0.20 {
        ('*', 1)         // * 星号（中）
    } else if cr < 0.70 {
        ('\u{00b7}', 0) // · 中心点（小）
    } else {
        ('.', 0)         // . 碎雪（极小）
    };
    Particle {
        x, y,
        vx: 0.0,
        vy: speed,
        brightness: 0.08 + rand_val() * 0.35, // 0.08-0.43 柔和
        twinkle_phase: rand_val() * std::f64::consts::TAU,
        twinkle_speed: 0.2 + rand_val() * 0.4, // 慢闪烁
        sway_phase: rand_val() * std::f64::consts::TAU,
        sway_speed: 0.3 + rand_val() * 0.6,
        sway_amplitude: 0.3 + rand_val() * 1.2, // 0.3-1.5 摇摆
        char, size, color,
    }
}

// xorshift 伪随机
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
