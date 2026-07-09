//! 动效系统：星光 + 流星（immediate-mode，每帧直接更新+渲染）
//!
//! ratatui 的动效非常简单：没有 widget 树、没有 timer 泄漏、没有 diff 开销。
//! 每帧 update(dt) 更新粒子位置，render(buf) 直接写 Buffer 的 cell。

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
    brightness: f64,   // 0..1
    twinkle_phase: f64, // 闪烁相位
    twinkle_speed: f64,
    char: char,
    alive: bool,
}

/// 流星拖尾段
#[derive(Clone)]
struct MeteorTail {
    x: i32,
    y: i32,
    age: f64, // 越老越暗
}

/// 动效系统状态
pub struct Fx {
    stars: Vec<Particle>,
    meteors: Vec<MeteorState>,
    last_frame: Instant,
    meteor_timer: f64,
    next_meteor: f64,
}

struct MeteorState {
    x: f64,
    y: f64,
    vx: f64,
    vy: f64,
    trail: Vec<(i32, i32)>,
    alive: bool,
}

impl Fx {
    pub fn new() -> Self {
        Self {
            stars: Vec::new(),
            meteors: Vec::new(),
            last_frame: Instant::now(),
            meteor_timer: 0.0,
            next_meteor: 8.0, // 第一颗流星 8 秒后
        }
    }

    /// 每帧调用：更新粒子 + 自动生成新星/流星
    pub fn update(&mut self, area: Rect) {
        let now = Instant::now();
        let dt = now.duration_since(self.last_frame).as_secs_f64();
        self.last_frame = now;
        let dt = dt.min(0.1); // 防止窗口切换后跳变

        let w = area.width as f64;
        let h = area.height as f64;
        if w < 1.0 || h < 1.0 {
            return;
        }

        // 维持星点数量（约 1 个/15 个 cell，但最多 80 个）
        let target = ((w * h) / 200.0) as usize;
        let target = target.min(80);
        while self.stars.len() < target {
            self.stars.push(Particle {
                x: rand_x(w),
                y: rand_y(h),
                vx: 0.0,
                vy: 0.15 + rand_val() * 0.25, // 缓慢下落
                brightness: 0.2 + rand_val() * 0.6,
                twinkle_phase: rand_val() * std::f64::consts::TAU,
                twinkle_speed: 1.0 + rand_val() * 3.0,
                char: pick_star_char(),
                alive: true,
            });
        }

        // 更新星点
        for s in &mut self.stars {
            s.y += s.vy * dt;
            s.twinkle_phase += s.twinkle_speed * dt;
            if s.y > h {
                s.y = 0.0;
                s.x = rand_x(w);
            }
        }

        // 流星自动触发
        self.meteor_timer += dt;
        if self.meteor_timer >= self.next_meteor {
            self.meteor_timer = 0.0;
            self.next_meteor = 8.0 + rand_val() * 7.0; // 8-15秒
            self.spawn_meteor(w, h);
        }

        // 更新流星
        for m in &mut self.meteors {
            m.x += m.vx * dt;
            m.y += m.vy * dt;
            m.trail.insert(0, (m.x as i32, m.y as i32));
            if m.trail.len() > 8 {
                m.trail.pop();
            }
            if m.x < -5.0 || m.y > h + 5.0 || m.x > w + 5.0 {
                m.alive = false;
            }
        }
        self.meteors.retain(|m| m.alive);
    }

    fn spawn_meteor(&mut self, w: f64, h: f64) {
        let angle = (18.0 + rand_val() * 16.0).to_radians();
        let speed = 18.0 + rand_val() * 8.0;
        self.meteors.push(MeteorState {
            x: w * (0.6 + rand_val() * 0.4), // 右上角区域
            y: -1.0,
            vx: -angle.cos() * speed,
            vy: angle.sin() * speed,
            trail: Vec::new(),
            alive: true,
        });
    }

    /// 渲染到 Buffer（直接写 cell，在内容之前画——作为背景层）
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
            // 闪烁：sin 脉动亮度
            let twinkle = (s.twinkle_phase.sin() + 1.0) * 0.5; // 0..1
            let brightness = s.brightness * (0.3 + 0.7 * twinkle);
            let color = scale_color(colors::PRIMARY, brightness);
            let idx = (abs_y as usize) * (buf.area.width as usize) + (abs_x as usize);
            if idx < buf.content.len() {
                let cell = &mut buf.content[idx];
                // 只覆盖空白 cell（不盖住实际内容）
                if cell.symbol() == " " {
                    cell.set_char(s.char);
                    cell.set_style(Style::default().fg(color));
                }
            }
        }

        // 流星拖尾
        for m in &self.meteors {
            for (i, &(tx, ty)) in m.trail.iter().enumerate() {
                if tx < 0 || ty < 0 {
                    continue;
                }
                let abs_x = area.x + tx as u16;
                let abs_y = area.y + ty as u16;
                if abs_x >= buf.area.width || abs_y >= buf.area.height {
                    continue;
                }
                let fade = 1.0 - (i as f64 / m.trail.len() as f64);
                let char = if i == 0 { '✦' } else if i < 3 { '·' } else { ' ' };
                if char == ' ' {
                    continue;
                }
                let color = scale_color(colors::CYAN, fade);
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

// ---- 工具函数 ----

fn rand_val() -> f64 {
    // 简单的伪随机（不用 rand crate 减少依赖）
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

fn rand_x(w: f64) -> f64 {
    rand_val() * w
}

fn rand_y(h: f64) -> f64 {
    rand_val() * h
}

fn pick_star_char() -> char {
    let chars = ['·', '·', '·', '•', '*', '+', '˖'];
    let idx = (rand_val() * chars.len() as f64) as usize;
    chars[idx.min(chars.len() - 1)]
}

/// 按亮度缩放颜色（0=黑，1=原色）
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
