//! 动效系统：星云粒子流 + 流星（immediate-mode，每帧直接更新+渲染）
//!
//! 粒子斜向缓慢流动，三色随机（粉/青/紫），低亮度不刺眼。
//! 流星周期性出现，长拖尾带淡入淡出。

use std::time::Instant;

use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};

use crate::app::colors;

/// 粒子颜色种类
#[derive(Clone, Copy)]
enum ParticleColor {
    Pink,
    Cyan,
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
    char: char,
    color: ParticleColor,
}

/// 流星
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

        // 粒子密度：约 1/180 cell，上限 80
        let target = ((w * h) / 180.0) as usize;
        let target = target.min(80);
        while self.particles.len() < target {
            self.particles.push(spawn_particle(w, h, true));
        }

        for p in &mut self.particles {
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.twinkle_phase += p.twinkle_speed * dt;
            // 飘出左侧/底部后从右侧/顶部重生
            if p.x < -2.0 || p.y > h + 2.0 {
                *p = spawn_particle(w, h, false);
            }
        }

        // 流星自动触发（8-15 秒）
        self.meteor_timer += dt;
        if self.meteor_timer >= self.next_meteor {
            self.meteor_timer = 0.0;
            self.next_meteor = 8.0 + rand_val() * 7.0;
            self.spawn_meteor(w, h);
        }

        // 更新流星
        for m in &mut self.meteors {
            m.x += m.vx * dt;
            m.y += m.vy * dt;
            m.age += dt;
            m.trail.insert(0, (m.x as i32, m.y as i32));
            if m.trail.len() > 12 {
                m.trail.pop();
            }
            if m.x < -5.0 || m.y > h + 5.0 || m.x > w + 5.0 || m.y < -5.0 {
                m.alive = false;
            }
        }
        self.meteors.retain(|m| m.alive);
    }

    fn spawn_meteor(&mut self, w: f64, _h: f64) {
        let angle = (15.0 + rand_val() * 35.0).to_radians();
        let speed = 15.0 + rand_val() * 10.0;
        let start_x = w * (0.4 + rand_val() * 0.6);
        let color = if rand_val() < 0.5 {
            ParticleColor::Cyan
        } else {
            ParticleColor::Pink
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

    /// 渲染到 Buffer（内容之后画，只覆盖空白 cell）
    pub fn render(&self, buf: &mut Buffer, area: Rect) {
        // 粒子
        for p in &self.particles {
            let x = p.x as u16;
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
                ParticleColor::Pink => colors::PINK,
                ParticleColor::Cyan => colors::CYAN,
                ParticleColor::Purple => colors::PURPLE,
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

        // 流星拖尾（带淡入淡出）
        for m in &self.meteors {
            let life_fade = if m.age > m.max_age - 0.5 {
                ((m.max_age - m.age) / 0.5).max(0.0)
            } else {
                1.0
            };
            let base = match m.color {
                ParticleColor::Pink => colors::PINK,
                ParticleColor::Cyan => colors::CYAN,
                ParticleColor::Purple => colors::PURPLE,
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
                let char = if i == 0 {
                    '•'
                } else if i < 5 {
                    '·'
                } else {
                    continue;
                };
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

/// 创建粒子。initial=true 时随机位置（首次生成）；false 时从右侧/顶部进入（重生）
fn spawn_particle(w: f64, h: f64, initial: bool) -> Particle {
    // 角度 200°-250°（左下方向）
    let angle = (200.0 + rand_val() * 50.0).to_radians();
    let speed = 3.0 + rand_val() * 5.0; // 3-8 cell/秒
    let (x, y) = if initial {
        (rand_val() * w, rand_val() * h)
    } else {
        // 从右侧或顶部进入
        if rand_val() < 0.5 {
            (w + 1.0, rand_val() * h)
        } else {
            (rand_val() * w, -1.0)
        }
    };
    // 三色随机，权重 4:4:2
    let r = rand_val();
    let color = if r < 0.4 {
        ParticleColor::Pink
    } else if r < 0.8 {
        ParticleColor::Cyan
    } else {
        ParticleColor::Purple
    };
    Particle {
        x,
        y,
        vx: -angle.cos() * speed,
        vy: angle.sin() * speed,
        brightness: 0.15 + rand_val() * 0.35, // 0.15-0.5 低亮度
        twinkle_phase: rand_val() * std::f64::consts::TAU,
        twinkle_speed: 0.3 + rand_val() * 0.4, // 0.3-0.7 慢闪烁
        char: if rand_val() < 0.8 { '·' } else { '•' },
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
