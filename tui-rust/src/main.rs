//! Precis TUI (Rust + ratatui) — 主入口
//!
//! MVP 功能：
//! - 启动时连接 Python FastAPI 后端
//! - 扫描项目列表 → 选择 → 打开
//! - 执行校验 → 结果展示（摘要 + 错误表格）
//! - 60fps 全屏渲染（ratatui，无 Textual 的性能瓶颈）

mod api;
mod app;
mod ui;

use std::io;
use std::time::Duration;

use anyhow::Result;
use crossterm::event::{self, Event, KeyCode, KeyEventKind};
use crossterm::execute;
use crossterm::terminal::{
    disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen,
};
use crossterm::ExecutableCommand;
use ratatui::backend::CrosstermBackend;
use ratatui::Terminal;

use crate::app::{App, Tab, ValidationState};

/// 后端默认地址（可通过环境变量 PRECIS_BACKEND_URL 覆盖）
fn backend_url() -> String {
    std::env::var("PRECIS_BACKEND_URL").unwrap_or_else(|_| "http://127.0.0.1:18000".to_string())
}

/// 扫描工作目录（默认 qa_test，可通过环境变量覆盖）
fn scan_work_dir() -> String {
    let manifest_dir = std::env::current_dir().unwrap_or_default();
    let project_root = manifest_dir
        .parent() // 退到 Precis 根
        .unwrap_or(&manifest_dir);
    let default = project_root.join("qa_test");
    std::env::var("PRECIS_WORK_DIR").unwrap_or_else(|_| default.to_string_lossy().to_string())
}

#[tokio::main]
async fn main() -> Result<()> {
    // 初始化日志（输出到 stderr，不干扰 TUI）
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("warn")),
        )
        .init();

    let url = backend_url();
    tracing::info!("后端地址: {}", url);

    let mut app = App::new(&url);

    // 启动时尝试连接后端 + 扫描项目
    match try_init(&mut app).await {
        Ok(()) => tracing::info!("初始化成功"),
        Err(e) => {
            tracing::warn!("初始化失败（后端可能未运行）: {}", e);
            app.message = format!("后端未连接，请先启动后端 (npm run backend:dev)");
        }
    }

    // 初始化终端
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen)?;
    stdout.execute(EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;
    terminal.clear()?;

    // 主事件循环
    let result = run_app(&mut terminal, &mut app).await;

    // 恢复终端
    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    terminal.show_cursor()?;

    result
}

/// 启动时初始化：健康检查 + 扫描项目
async fn try_init(app: &mut App) -> Result<()> {
    if !app.api.health().await.unwrap_or(false) {
        anyhow::bail!("健康检查失败");
    }
    app.message = "后端已连接".to_string();

    let work_dir = scan_work_dir();
    tracing::info!("扫描目录: {}", work_dir);
    match app.api.scan_projects(&work_dir).await {
        Ok(projects) => {
            app.message = format!("找到 {} 个项目", projects.len());
            app.projects = projects;
        }
        Err(e) => {
            tracing::warn!("扫描失败: {}", e);
        }
    }
    Ok(())
}

/// 主事件循环（33fps ≈ 30ms/帧，平衡流畅度与 CPU）
async fn run_app(
    terminal: &mut Terminal<CrosstermBackend<io::Stdout>>,
    app: &mut App,
) -> Result<()> {
    loop {
        terminal.draw(|f| ui::render(f, app))?;

        // 33fps：30ms 超时轮询事件，无事件时也重绘（动效需要）
        if event::poll(Duration::from_millis(33))? {
            let ev = event::read()?;
            if let Event::Key(key) = ev {
                if key.kind != KeyEventKind::Press {
                    continue;
                }
                handle_key(app, key.code).await;
            }
        }

        if app.should_quit {
            break;
        }
    }
    Ok(())
}

/// 处理按键事件
async fn handle_key(app: &mut App, key: KeyCode) {
    // 全局快捷键
    match key {
        KeyCode::Char('q') => {
            app.quit();
            return;
        }
        KeyCode::Tab => {
            let next_idx = (app.current_tab.index() + 1) % 5;
            if let Some(t) = crate::app::Tab::from_index(next_idx) {
                app.switch_tab(t);
            }
            return;
        }
        KeyCode::BackTab => {
            let prev_idx = if app.current_tab.index() == 0 { 4 } else { app.current_tab.index() - 1 };
            if let Some(t) = crate::app::Tab::from_index(prev_idx) {
                app.switch_tab(t);
            }
            return;
        }
        KeyCode::F(2) => {
            app.fx_enabled = !app.fx_enabled;
            app.message = if app.fx_enabled { "动效已开启" } else { "动效已关闭" }.to_string();
            return;
        }
        // 数字键 1-5 快速切换页面
        KeyCode::Char(c) if ('1'..='5').contains(&c) => {
            if let Some(t) = crate::app::Tab::from_index((c as usize) - ('1' as usize)) {
                app.switch_tab(t);
            }
            return;
        }
        _ => {}
    }

    // 页面级快捷键
    match key {
        // Dashboard 页：项目列表导航
        KeyCode::Down | KeyCode::Char('j') if app.current_tab == Tab::Dashboard => {
            if !app.projects.is_empty() {
                app.selected_project = (app.selected_project + 1) % app.projects.len();
            }
        }
        KeyCode::Up | KeyCode::Char('k') if app.current_tab == Tab::Dashboard => {
            if !app.projects.is_empty() {
                app.selected_project = if app.selected_project == 0 {
                    app.projects.len() - 1
                } else {
                    app.selected_project - 1
                };
            }
        }
        KeyCode::Enter if app.current_tab == Tab::Dashboard => {
            if let Some(p) = app.projects.get(app.selected_project) {
                let path = p.path.clone();
                let name = p.name.clone();
                app.validation = ValidationState::Idle;
                app.message = format!("正在打开 {}...", name);
                match app.api.open_project(&path).await {
                    Ok(resp) => {
                        if resp.success {
                            app.project_name = Some(name);
                            app.message = format!("已打开");
                            app.current_tab = Tab::Validation;
                        } else {
                            app.message = "打开项目失败".to_string();
                        }
                    }
                    Err(e) => {
                        app.message = format!("打开失败: {}", &e.to_string()[..e.to_string().len().min(50)]);
                    }
                }
            }
        }

        // Validation 页：执行校验
        KeyCode::Char('v') | KeyCode::Char('V') if app.current_tab == Tab::Validation => {
            if app.api.project_path().is_none() {
                app.message = "请先在 Dashboard 打开项目".to_string();
            } else {
                app.validation = ValidationState::Validating;
                app.message = "正在校验...".to_string();
                let result = app.api.validate_full().await;
                match result {
                    Ok(resp) => {
                        let err_count = resp.summary.total_error_count;
                        app.message = format!("校验完成: {} 个错误, {}ms", err_count, resp.summary.duration_ms);
                        app.validation = ValidationState::Done(Box::new(resp));
                    }
                    Err(e) => {
                        app.message = "校验失败".to_string();
                        app.validation = ValidationState::Failed(e.to_string());
                    }
                }
            }
        }

        _ => {}
    }
}
