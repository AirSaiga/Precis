//! 动效系统：星光 + 流星（immediate-mode，每帧直接更新+渲染）
//!
//! 星光只使用 · 和 • 两种字符（不与 UI 字符冲突）。
//! 流星增强随机性（任意角度出发）+ 淡入淡出。

use std::time::Instant;

use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};

use crate::app::colors;

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
    alive: bool,
}

/// 流星
struct MeteorState {
    x: f64,
    y: f64,
    vx: f64,
    vy: f64,
    trail: Vec<(i32, i32)>,
    age: f64,      // 生命周期（用于淡入淡出）
    max_age: f64,
    alive: bool,
}

/// 动效系统状态
pub struct Fx {
    stars: Vec<Particle>,
    meteors: Vec<MeteorState>,
    last_frame: Instant,
    meteor_timer: f64,
    next_meteor: f64,
}

impl Fx {
    pub fn new() -> Self {
        Self {
            stars: Vec::new(),
            meteors: Vec::new(),
            last_frame: Instant::now(),
            meteor_timer: 0.0,
            next_meteor: 6.0,
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

        // 星点密度：稀疏（约 1/250 cell，最多 50 个），Linear 风格背景氛围
        let target = ((w * h) / 250.0) as usize;
        let target = target.min(50);
        while self.stars.len() < target {
            self.stars.push(Particle {
                x: rand_val() * w,
                y: rand_val() * h,
                vx: 0.0,
                vy: 0.1 + rand_val() * 0.2,
                brightness: 0.2 + rand_val() * 0.45, // 适度亮度：作为背景氛围但不隐形
                twinkle_phase: rand_val() * std::f64::consts::TAU,
                twinkle_speed: 0.8 + rand_val() * 2.5,
                char: if rand_val() < 0.8 { '·' } else { '•' },
                alive: true,
            });
        }

        for s in &mut self.stars {
            s.y += s.vy * dt;
            s.twinkle_phase += s.twinkle_speed * dt;
            if s.y > h {
                s.y = 0.0;
                s.x = rand_val() * w;
            }
        }

        // 流星自动触发（6-12 秒）
        self.meteor_timer += dt;
        if self.meteor_timer >= self.next_meteor {
            self.meteor_timer = 0.0;
            self.next_meteor = 6.0 + rand_val() * 6.0;
            self.spawn_meteor(w, h);
        }

        // 更新流星
        for m in &mut self.meteors {
            m.x += m.vx * dt;
            m.y += m.vy * dt;
            m.age += dt;
            m.trail.insert(0, (m.x as i32, m.y as i32));
            if m.trail.len() > 10 {
                m.trail.pop();
            }
            if m.x < -5.0 || m.y > h + 5.0 || m.x > w + 5.0 || m.y < -5.0 {
                m.alive = false;
            }
        }
        self.meteors.retain(|m| m.alive);
    }

    fn spawn_meteor(&mut self, w: f64, _h: f64) {
        // 随机出发位置（顶部偏右）+ 随机角度（左下方向为主，但增加变化）
        let angle = (15.0 + rand_val() * 35.0).to_radians();
        let speed = 15.0 + rand_val() * 10.0;
        let start_x = w * (0.4 + rand_val() * 0.6);
        self.meteors.push(MeteorState {
            x: start_x,
            y: -1.0,
            vx: -angle.cos() * speed,
            vy: angle.sin() * speed,
            trail: Vec::new(),
            age: 0.0,
            max_age: 3.0,
            alive: true,
        });
    }

    /// 渲染到 Buffer（内容之后画，只覆盖空白 cell）
    pub fn render(&self, buf: &mut Buffer, area: Rect) {
        // 星点
        for s in &self.stars {
            if !s.alive {
                continue;
            }
            let x = s.x as u16;
            let y = s.y as u16;
            if x >= area.width || y >= area.height {
                continue;
            }
            let abs_x = area.x + x;
            let abs_y = area.y + y;
            if abs_x >= buf.area.width || abs_y >= buf.area.height {
                continue;
            }
            let twinkle = (s.twinkle_phase.sin() + 1.0) * 0.5;
            let brightness = s.brightness * (0.3 + 0.7 * twinkle);
            let color = scale_color(colors::PRIMARY, brightness);
            let idx = (abs_y as usize) * (buf.area.width as usize) + (abs_x as usize);
            if idx < buf.content.len() {
                let cell = &mut buf.content[idx];
                if cell.symbol() == " " {
                    cell.set_char(s.char);
                    cell.set_style(Style::default().fg(color));
                }
            }
        }

        // 流星拖尾（带淡入淡出）
        for m in &self.meteors {
            // 生命周期淡出（最后 0.5 秒渐暗）
            let life_fade = if m.age > m.max_age - 0.5 {
                ((m.max_age - m.age) / 0.5).max(0.0)
            } else {
                1.0
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
                let char = if i == 0 { '·' } else if i < 4 { '·' } else { continue };
                let color = scale_color(colors::CYAN, trail_fade.max(0.2));
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

fn scale_color(base: Color, brightness: f64) -> Color {
    let b = brightness.clamp(0.0, 1.0);
    match base {
        Color::Rgb(r, g, bl) => Color::Rgb(
            (r as f64 * b) as u8,
            (g as f64 * b) as u8,
            (bl as f64 * b) as u8,
        ),
        other => other,
    }
}
