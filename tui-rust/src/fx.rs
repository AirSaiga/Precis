//! 动效系统：双主题粒子（樱花星云 / 飘雪）
//!
//! 樱花主题：粒子斜向缓慢流动，三色（粉/青/紫），流星长拖尾。
//! 飘雪主题：雪花垂直下落 + 轻微摇摆，两色（冰蓝/月白），大雪片短拖尾。
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
    /// 摇摆：用 vx 偏移模拟（update 中实时算）
    sway_phase: f64,
    sway_speed: f64,
    sway_amplitude: f64,
    char: char,
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

/// 动效系统状态
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
            next_meteor: 8.0,
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

        // 粒子密度：樱花 1/180，飘雪 1/300（更稀疏、安静）
        let divisor = if is_snow { 300.0 } else { 180.0 };
        let target = ((w * h) / divisor) as usize;
        let target = target.min(if is_snow { 50 } else { 80 });
        while self.particles.len() < target {
            self.particles.push(spawn_particle(w, h, true));
        }

        for p in &mut self.particles {
            p.twinkle_phase += p.twinkle_speed * dt;
            p.sway_phase += p.sway_speed * dt;

            if is_snow {
                // 飘雪：垂直下落 + 摇摆叠加到 x（连续运动，不在 render 时跳）
                p.y += p.vy * dt;
                p.x += p.sway_phase.sin() * p.sway_amplitude * dt;
                // 飘出底部或侧边后从顶部重生
                if p.y > h + 2.0 || p.x < -2.0 || p.x > w + 2.0 {
                    *p = spawn_particle(w, h, false);
                }
            } else {
                // 樱花：斜向流动
                p.x += p.vx * dt;
                p.y += p.vy * dt;
                if p.x < -2.0 || p.y > h + 2.0 {
                    *p = spawn_particle(w, h, false);
                }
            }
        }

        // 流星 / 大雪片触发
        self.meteor_timer += dt;
        if self.meteor_timer >= self.next_meteor {
            self.meteor_timer = 0.0;
            if is_snow {
                self.next_meteor = 6.0 + rand_val() * 6.0;
            } else {
                self.next_meteor = 8.0 + rand_val() * 7.0;
            }
            self.spawn_meteor(w, h);
        }

        // 更新流星 / 大雪片
        for m in &mut self.meteors {
            m.x += m.vx * dt;
            m.y += m.vy * dt;
            m.age += dt;
            m.trail.insert(0, (m.x as i32, m.y as i32));
            let max_trail = if is_snow { 5 } else { 12 };
            if m.trail.len() > max_trail {
                m.trail.pop();
            }
            if m.x < -5.0 || m.y > h + 5.0 || m.x > w + 5.0 || m.y < -5.0 {
                m.alive = false;
            }
        }
        self.meteors.retain(|m| m.alive);
    }

    fn spawn_meteor(&mut self, w: f64, _h: f64) {
        if colors::theme() == 1 {
            // 飘雪：大雪片垂直下落 + 短拖尾
            let speed = 6.0 + rand_val() * 4.0;
            let start_x = rand_val() * w;
            self.meteors.push(MeteorState {
                x: start_x,
                y: -1.0,
                vx: (rand_val() - 0.5) * 2.0, // 轻微水平偏移
                vy: speed,
                trail: Vec::new(),
                age: 0.0,
                max_age: 4.0,
                alive: true,
                color: ParticleColor::Primary,
            });
        } else {
            // 樱花：斜向流星 + 长拖尾
            let angle = (15.0 + rand_val() * 35.0).to_radians();
            let speed = 15.0 + rand_val() * 10.0;
            let start_x = w * (0.4 + rand_val() * 0.6);
            let color = if rand_val() < 0.5 {
                ParticleColor::Secondary
            } else {
                ParticleColor::Primary
            };
            self.meteors.push(MeteorState {
                x: start_x,
                y: -1.0,
                vx: -angle.cos() * speed,
                vy: angle.sin() * speed,
                trail: Vec::new(),
                age: 0.0,
                max_age: 3.0,
                alive: true,
                color,
            });
        }
    }

    /// 渲染到 Buffer（内容之后画，只覆盖空白 cell）
    pub fn render(&self, buf: &mut Buffer, area: Rect) {
        let is_snow = colors::theme() == 1;

        // 粒子
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
            let brightness = p.brightness * (0.3 + 0.7 * twinkle);
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
                    cell.set_style(Style::default().fg(color));
                }
            }
        }

        // 流星 / 大雪片拖尾
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
                // 全部单宽字符
                let (char, max_idx) = if is_snow {
                    // 飘雪：头部 *，拖尾 ·
                    if i == 0 { ('*', 3) } else { ('·', 3) }
                } else {
                    // 樱花：头部 •，拖尾 ·
                    if i == 0 { ('•', 5) } else { ('·', 5) }
                };
                if i >= max_idx {
                    continue;
                }
                let color = colors::scale(base, trail_fade.max(0.2));
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

/// 创建粒子
fn spawn_particle(w: f64, h: f64, initial: bool) -> Particle {
    if colors::theme() == 1 {
        spawn_snowflake(w, h, initial)
    } else {
        spawn_sakura_particle(w, h, initial)
    }
}

/// 樱花主题粒子：斜向飘动，三色（粉/青/紫）
fn spawn_sakura_particle(w: f64, h: f64, initial: bool) -> Particle {
    let angle = (200.0 + rand_val() * 50.0).to_radians();
    let speed = 3.0 + rand_val() * 5.0;
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
    } else if r < 0.8 {
        ParticleColor::Secondary
    } else {
        ParticleColor::Purple
    };
    Particle {
        x, y,
        vx: -angle.cos() * speed,
        vy: angle.sin() * speed,
        brightness: 0.15 + rand_val() * 0.35,
        twinkle_phase: rand_val() * std::f64::consts::TAU,
        twinkle_speed: 0.3 + rand_val() * 0.4,
        sway_phase: 0.0,
        sway_speed: 0.0,
        sway_amplitude: 0.0,
        char: if rand_val() < 0.8 { '·' } else { '•' },
        color,
    }
}

/// 飘雪主题粒子：垂直下落 + 摇摆，两色（冰蓝/月白）
fn spawn_snowflake(w: f64, h: f64, initial: bool) -> Particle {
    let speed = 1.5 + rand_val() * 2.5; // 1.5-4 cell/秒，更慢更安静
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
    // 雪花字符全部单宽：· 为主，* 和 + 少量点缀
    let r = rand_val();
    let char = if r < 0.7 { '·' } else if r < 0.9 { '*' } else { '+' };
    Particle {
        x, y,
        vx: 0.0,
        vy: speed,
        brightness: 0.1 + rand_val() * 0.3, // 0.1-0.4 更柔和
        twinkle_phase: rand_val() * std::f64::consts::TAU,
        twinkle_speed: 0.15 + rand_val() * 0.25, // 慢闪烁
        sway_phase: rand_val() * std::f64::consts::TAU,
        sway_speed: 0.3 + rand_val() * 0.5,
        sway_amplitude: 0.3 + rand_val() * 0.7, // 0.3-1.0 摇摆幅度
        char,
        color,
    }
}

// xorshift 伪随机（无外部依赖）
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
