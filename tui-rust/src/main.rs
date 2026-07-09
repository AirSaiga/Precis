//! Precis TUI (Rust + ratatui) — 主入口
//!
//! 架构：同步事件循环 + tokio::spawn 异步 HTTP + mpsc channel 回传结果
//! 渲染循环永不阻塞（HTTP 在后台 task 里跑，结果通过 channel 送回）

mod api;
mod app;
mod fx;
mod icons;
mod ui;

use std::io;
use std::time::Duration;

use anyhow::Result;
use crossterm::event::{self, Event, KeyCode};
use crossterm::execute;
use crossterm::terminal::{
    disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen,
};
use crossterm::ExecutableCommand;
use ratatui::backend::CrosstermBackend;
use ratatui::Terminal;
use tokio::sync::mpsc;

use crate::app::{App, Tab, ValidationState};
use crate::api::types::{FullValidationResponse, OpenProjectResponse};

fn backend_url() -> String {
    std::env::var("PRECIS_BACKEND_URL").unwrap_or_else(|_| "http://127.0.0.1:18000".to_string())
}

fn scan_work_dir() -> String {
    let cwd = std::env::current_dir().unwrap_or_default();
    let project_root = cwd.parent().unwrap_or(&cwd);
    let default = project_root.join("qa_test");
    std::env::var("PRECIS_WORK_DIR").unwrap_or_else(|_| default.to_string_lossy().to_string())
}

/// 后台任务 → 事件循环的消息
enum BgMessage {
    ProjectOpened { name: String, path: String, success: bool },
    ValidationDone(Result<FullValidationResponse, String>),
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("warn")),
        )
        .init();

    let url = backend_url();
    let mut app = App::new(&url);

    match try_init(&mut app).await {
        Ok(()) => {}
        Err(e) => {
            app.message = "Backend not connected".to_string();
            tracing::warn!("Init failed: {}", e);
        }
    }

    // channel：后台 HTTP 任务 → 主循环
    let (tx, mut rx) = mpsc::channel::<BgMessage>(32);

    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;
    terminal.clear()?;

    let result = run_app(&mut terminal, &mut app, &tx, &mut rx).await;

    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    terminal.show_cursor()?;

    result
}

async fn try_init(app: &mut App) -> Result<()> {
    if !app.api.health().await.unwrap_or(false) {
        anyhow::bail!("health check failed");
    }
    app.message = "Backend connected".to_string();

    let work_dir = scan_work_dir();
    match app.api.scan_projects(&work_dir).await {
        Ok(projects) => {
            app.message = format!("{} projects", projects.len());
            app.projects = projects;
        }
        Err(e) => tracing::warn!("Scan failed: {}", e),
    }
    Ok(())
}

/// 主事件循环
async fn run_app(
    terminal: &mut Terminal<CrosstermBackend<io::Stdout>>,
    app: &mut App,
    tx: &mpsc::Sender<BgMessage>,
    rx: &mut mpsc::Receiver<BgMessage>,
) -> Result<()> {
    loop {
        // 处理后台消息（非阻塞）
        while let Ok(msg) = rx.try_recv() {
            handle_bg_message(app, msg);
        }

        // 渲染
        terminal.draw(|f| ui::render(f, app))?;

        // 事件轮询（33fps）
        if event::poll(Duration::from_millis(33))? {
            let ev = event::read()?;
            if let Event::Key(key) = ev {
                handle_key(app, key.code, tx).await;
            }
            while event::poll(Duration::from_millis(0)).unwrap_or(false) {
                let _ = event::read();
            }
        }

        if app.should_quit {
            break;
        }
    }
    Ok(())
}

/// 处理后台任务返回的消息
fn handle_bg_message(app: &mut App, msg: BgMessage) {
    match msg {
        BgMessage::ProjectOpened { name, path, success } => {
            app.opening_project = false;
            if success {
                app.api.set_project(&path);
                app.project_name = Some(name);
                app.message = "Project opened".to_string();
                app.current_tab = Tab::Validation;
                app.validation = ValidationState::Idle;
            } else {
                app.message = "Open failed".to_string();
            }
        }
        BgMessage::ValidationDone(result) => {
            match result {
                Ok(resp) => {
                    let err_count = resp.summary.total_error_count;
                    app.message = format!("Done: {} errors, {}ms", err_count, resp.summary.duration_ms);
                    app.validation = ValidationState::Done(Box::new(resp));
                }
                Err(e) => {
                    app.message = "Validation failed".to_string();
                    app.validation = ValidationState::Failed(e);
                }
            }
        }
    }
}

/// 处理按键
async fn handle_key(app: &mut App, key: KeyCode, tx: &mpsc::Sender<BgMessage>) {
    // 全局
    match key {
        KeyCode::Char('q') => { app.quit(); return; }
        KeyCode::Tab => {
            let next = (app.current_tab.index() + 1) % 5;
            if let Some(t) = Tab::from_index(next) { app.switch_tab(t); }
            return;
        }
        KeyCode::BackTab => {
            let prev = if app.current_tab.index() == 0 { 4 } else { app.current_tab.index() - 1 };
            if let Some(t) = Tab::from_index(prev) { app.switch_tab(t); }
            return;
        }
        KeyCode::F(2) => {
            app.fx_enabled = !app.fx_enabled;
            app.message = if app.fx_enabled { "FX on" } else { "FX off" }.to_string();
            return;
        }
        KeyCode::Char(c) if ('1'..='5').contains(&c) => {
            if let Some(t) = Tab::from_index((c as usize) - ('1' as usize)) { app.switch_tab(t); }
            return;
        }
        _ => {}
    }

    // 页面级
    match key {
        // Dashboard 导航
        KeyCode::Down | KeyCode::Char('j') if app.current_tab == Tab::Dashboard => {
            if !app.projects.is_empty() {
                app.selected_project = (app.selected_project + 1) % app.projects.len();
            }
        }
        KeyCode::Up | KeyCode::Char('k') if app.current_tab == Tab::Dashboard => {
            if !app.projects.is_empty() {
                app.selected_project = if app.selected_project == 0 {
                    app.projects.len() - 1
                } else { app.selected_project - 1 };
            }
        }
        // 打开项目（异步 spawn）
        KeyCode::Enter if app.current_tab == Tab::Dashboard && !app.opening_project => {
            if let Some(p) = app.projects.get(app.selected_project).cloned() {
                app.opening_project = true;
                app.message = format!("Opening {}...", p.name);
                let tx = tx.clone();
                let url = backend_url();
                tokio::spawn(async move {
                    let client = crate::api::ApiClient::new(&url);
                    let msg = match client.open_project_static(&p.path).await {
                        Ok(resp) => BgMessage::ProjectOpened {
                            name: p.name,
                            path: p.path,
                            success: resp.success,
                        },
                        Err(e) => {
                            tracing::warn!("Open project failed: {}", e);
                            BgMessage::ProjectOpened {
                                name: String::new(),
                                path: String::new(),
                                success: false,
                            }
                        }
                    };
                    let _ = tx.send(msg).await;
                });
            }
        }

        // 校验（异步 spawn）
        KeyCode::Char('v') | KeyCode::Char('V') if app.current_tab == Tab::Validation => {
            if let Some(path) = app.api.project_path().map(|s| s.to_string()) {
                if !matches!(app.validation, ValidationState::Validating) {
                    app.validation = ValidationState::Validating;
                    app.message = "Validating...".to_string();
                    app.error_cursor = 0;
                    let tx = tx.clone();
                    let url = backend_url();
                    tokio::spawn(async move {
                        let mut client = crate::api::ApiClient::new(&url);
                        client.set_project(&path);
                        let result = client.validate_full().await;
                        let msg = BgMessage::ValidationDone(result.map_err(|e| e.to_string()));
                        let _ = tx.send(msg).await;
                    });
                }
            } else {
                app.message = "Open a project first".to_string();
            }
        }

        // Validation 错误表格滚动
        KeyCode::Down | KeyCode::Char('j') if app.current_tab == Tab::Validation => {
            if let ValidationState::Done(resp) = &app.validation {
                let max = resp.errors.len().saturating_sub(1);
                if app.error_cursor < max { app.error_cursor += 1; }
            }
        }
        KeyCode::Up | KeyCode::Char('k') if app.current_tab == Tab::Validation => {
            if app.error_cursor > 0 { app.error_cursor -= 1; }
        }

        _ => {}
    }
}
