//! 动效系统：双主题氛围光晕（樱花 / 飘雪）
//!
//! 不使用字符粒子（廉价感），改用极淡彩色背景填充空白 cell。
//! 效果：柔和的光斑/光雾在背景中缓慢流动，像极光或光晕。
//! 流星/雪片用短暂的亮背景拖尾表现。

use std::time::Instant;

use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::Style;

use crate::app::colors;

#[derive(Clone, Copy)]
enum ParticleColor {
    Primary,
    Secondary,
    Purple,
}

/// 光晕粒子 — 只用背景色，不画字符
#[derive(Clone)]
struct Particle {
    x: f64,
    y: f64,
    vx: f64,
    vy: f64,
    /// 基础强度（0.02-0.06，极淡）
    intensity: f64,
    breathe_phase: f64,
    breathe_speed: f64,
    sway_phase: f64,
    sway_speed: f64,
    sway_amplitude: f64,
    color: ParticleColor,
}

/// 流星 / 光带 — 用亮背景拖尾
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
            next_meteor: 5.0,
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

        // 光晕密度：稀疏，上限 35
        let divisor = if is_snow { 300.0 } else { 350.0 };
        let target = ((w * h) / divisor) as usize;
        let target = target.min(35);
        while self.particles.len() < target {
            self.particles.push(spawn_particle(w, h, true));
        }

        for p in &mut self.particles {
            p.breathe_phase += p.breathe_speed * dt;
            p.sway_phase += p.sway_speed * dt;

            if is_snow {
                p.y += p.vy * dt;
                p.x += p.sway_phase.sin() * p.sway_amplitude * dt;
                if p.y > h + 2.0 || p.x < -3.0 || p.x > w + 3.0 {
                    *p = spawn_particle(w, h, false);
                }
            } else {
                p.x += p.vx * dt;
                p.y += p.vy * dt;
                if p.x < -3.0 || p.y > h + 3.0 || p.x > w + 3.0 {
                    *p = spawn_particle(w, h, false);
                }
            }
        }

        // 流星 / 光带
        self.meteor_timer += dt;
        if self.meteor_timer >= self.next_meteor {
            self.meteor_timer = 0.0;
            if is_snow {
                self.next_meteor = 6.0 + rand_val() * 6.0;
            } else {
                self.next_meteor = 4.0 + rand_val() * 5.0;
            }
            self.spawn_meteor(w, h);
        }

        for m in &mut self.meteors {
            m.x += m.vx * dt;
            m.y += m.vy * dt;
            m.age += dt;
            m.trail.insert(0, (m.x as i32, m.y as i32));
            let max_trail = if is_snow { 6 } else { 16 };
            if m.trail.len() > max_trail {
                m.trail.pop();
            }
            if m.x < -10.0 || m.y > h + 10.0 || m.x > w + 10.0 || m.y < -10.0 {
                m.alive = false;
            }
        }
        self.meteors.retain(|m| m.alive);
    }

    fn spawn_meteor(&mut self, w: f64, _h: f64) {
        if colors::theme() == 1 {
            let speed = 4.0 + rand_val() * 3.0;
            let start_x = rand_val() * w;
            self.meteors.push(MeteorState {
                x: start_x, y: -1.0,
                vx: (rand_val() - 0.5) * 1.5,
                vy: speed,
                trail: Vec::new(),
                age: 0.0, max_age: 5.0, alive: true,
                color: if rand_val() < 0.6 { ParticleColor::Primary } else { ParticleColor::Secondary },
            });
        } else {
            let angle = (20.0 + rand_val() * 30.0).to_radians();
            let speed = 20.0 + rand_val() * 10.0;
            let start_x = w * (0.3 + rand_val() * 0.7);
            let color = match rand_val() {
                r if r < 0.4 => ParticleColor::Primary,
                r if r < 0.75 => ParticleColor::Secondary,
                _ => ParticleColor::Purple,
            };
            self.meteors.push(MeteorState {
                x: start_x, y: -1.0,
                vx: -angle.cos() * speed,
                vy: angle.sin() * speed,
                trail: Vec::new(),
                age: 0.0, max_age: 2.5, alive: true,
                color,
            });
        }
    }

    pub fn render(&self, buf: &mut Buffer, area: Rect) {
        // ===== 光晕粒子：只设背景色，不画字符 =====
        for p in &self.particles {
            let x = p.x as i32 as u16;
            let y = p.y as i32 as u16;
            if x >= area.width || y >= area.height {
                continue;
            }
            let abs_x = area.x + x;
            let abs_y = area.y + y;
            if abs_x >= buf.area.width || abs_y >= buf.area.height {
                continue;
            }
            // 呼吸：强度在 50%-100% 间波动
            let breathe = (p.breathe_phase.sin() + 1.0) * 0.5;
            let alpha = p.intensity * (0.5 + 0.5 * breathe);
            let base = match p.color {
                ParticleColor::Primary => colors::pink(),
                ParticleColor::Secondary => colors::cyan(),
                ParticleColor::Purple => colors::purple(),
            };
            // 把主题色以极淡透明度混合到背景色上
            let bg = colors::blend(colors::bg(), base, alpha);
            let idx = (abs_y as usize) * (buf.area.width as usize) + (abs_x as usize);
            if idx < buf.content.len() {
                let cell = &mut buf.content[idx];
                if cell.symbol() == " " {
                    cell.set_style(Style::default().bg(bg));
                }
            }
        }

        // ===== 流星 / 光带拖尾：用亮背景表现 =====
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
                if tx < 0 || ty < 0 { continue; }
                let abs_x = area.x + tx as u16;
                let abs_y = area.y + ty as u16;
                if abs_x >= buf.area.width || abs_y >= buf.area.height { continue; }
                let trail_fade = (1.0 - (i as f64 / m.trail.len() as f64)) * life_fade;
                let max_idx = if colors::theme() == 1 { 4 } else { 8 };
                if i >= max_idx { continue; }
                // 拖尾用较亮的背景色混合
                let alpha = trail_fade * 0.15;
                let bg = colors::blend(colors::bg(), base, alpha);
                let idx = (abs_y as usize) * (buf.area.width as usize) + (abs_x as usize);
                if idx < buf.content.len() {
                    let cell = &mut buf.content[idx];
                    if cell.symbol() == " " {
                        cell.set_style(Style::default().bg(bg));
                    }
                }
            }
        }
    }
}

fn spawn_particle(w: f64, h: f64, initial: bool) -> Particle {
    if colors::theme() == 1 {
        spawn_snow_glow(w, h, initial)
    } else {
        spawn_star_glow(w, h, initial)
    }
}

/// 樱花主题光晕：近乎静止，极慢飘动
fn spawn_star_glow(w: f64, h: f64, initial: bool) -> Particle {
    let (x, y) = if initial {
        (rand_val() * w, rand_val() * h)
    } else {
        if rand_val() < 0.5 { (w + 1.0, rand_val() * h) } else { (rand_val() * w, -1.0) }
    };
    let r = rand_val();
    let color = if r < 0.4 { ParticleColor::Primary }
                else if r < 0.75 { ParticleColor::Secondary }
                else { ParticleColor::Purple };
    let angle = (200.0 + rand_val() * 60.0).to_radians();
    let speed = 0.3 + rand_val() * 0.7;
    Particle {
        x, y,
        vx: -angle.cos() * speed,
        vy: angle.sin() * speed,
        intensity: 0.03 + rand_val() * 0.04, // 0.03-0.07 极淡
        breathe_phase: rand_val() * std::f64::consts::TAU,
        breathe_speed: 0.3 + rand_val() * 0.5,
        sway_phase: 0.0, sway_speed: 0.0, sway_amplitude: 0.0,
        color,
    }
}

/// 飘雪主题光晕：慢速垂直下落 + 摇摆
fn spawn_snow_glow(w: f64, h: f64, initial: bool) -> Particle {
    let speed = 0.8 + rand_val() * 2.0;
    let (x, y) = if initial {
        (rand_val() * w, rand_val() * h)
    } else {
        (rand_val() * w, -1.0)
    };
    let color = if rand_val() < 0.6 { ParticleColor::Primary } else { ParticleColor::Secondary };
    Particle {
        x, y,
        vx: 0.0, vy: speed,
        intensity: 0.03 + rand_val() * 0.04,
        breathe_phase: rand_val() * std::f64::consts::TAU,
        breathe_speed: 0.2 + rand_val() * 0.3,
        sway_phase: rand_val() * std::f64::consts::TAU,
        sway_speed: 0.3 + rand_val() * 0.5,
        sway_amplitude: 0.3 + rand_val() * 0.8,
        color,
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
