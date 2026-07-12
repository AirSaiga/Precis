//! Precis TUI (Rust + ratatui) — 主入口
//!
//! 架构：同步事件循环 + tokio::spawn 异步 HTTP + mpsc channel 回传结果
//! 渲染循环永不阻塞（HTTP 在后台 task 里跑，结果通过 channel 送回）

mod api;
mod app;
mod fx;
mod icons;
mod theme;
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
use tokio::sync::mpsc;

use crate::app::{App, ChatMsg, Tab, TestResult, ValidationState};
use crate::api::types::{AiChatResponse, ChatMessage, FullValidationResponse, FullConfigResponse, OpenProjectResponse, ProviderInfo};

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
    ProvidersLoaded { providers: Vec<ProviderInfo>, active_id: Option<String> },
    /// 触发重新拉取 providers + active（无数据）
    RefreshProviders,
    ProviderTested { id: String, result: Result<String, String> },
    ConfigLoaded(Result<FullConfigResponse, String>),
    ChatReply(Result<AiChatResponse, String>),
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

    // 加载持久化主题并应用到 thread_local
    let saved_theme = theme::load_theme();
    app.theme = saved_theme;
    app::colors::set_theme(saved_theme.idx());

    match try_init(&mut app).await {
        Ok(()) => {}
        Err(e) => {
            app.message = "后端未连接".to_string();
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
    app.message = "后端已连接".to_string();

    let work_dir = scan_work_dir();
    match app.api.scan_projects(&work_dir).await {
        Ok(projects) => {
            app.message = format!("找到 {} 个项目", projects.len());
            app.projects = projects;
            // BUG-8: 扫描后重置选中索引，避免越界
            app.selected_project = 0;
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
            handle_bg_message(app, msg, tx);
        }

        // 渲染
        terminal.draw(|f| ui::render(f, app))?;

        // 事件轮询（33fps）
        if event::poll(Duration::from_millis(33))? {
            let ev = event::read()?;
            if let Event::Key(key) = ev {
                // 忽略重复/释放事件，防止一次按键触发多次（如 Tab 切换两页）
                if key.kind == KeyEventKind::Press {
                    handle_key(app, key.code, tx).await;
                }
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
fn handle_bg_message(app: &mut App, msg: BgMessage, tx: &mpsc::Sender<BgMessage>) {
    match msg {
        BgMessage::ProjectOpened { name, path, success } => {
            app.opening_project = false;
            if success {
                app.api.set_project(&path);
                app.project_name = Some(name);
                app.message = "项目已打开".to_string();
                app.current_tab = Tab::Validation;
                app.validation = ValidationState::Idle;
                // BUG-8/17: 打开项目后重置错误列表 cursor，避免越界
                app.error_cursor = 0;
            } else {
                app.message = "打开失败".to_string();
            }
        }
        BgMessage::ValidationDone(result) => {
            match result {
                Ok(resp) => {
                    let err_count = resp.summary.total_error_count;
                    app.message = format!("完成: {} 个错误, {}ms", err_count, resp.summary.duration_ms);
                    app.validation = ValidationState::Done(Box::new(resp));
                }
                Err(e) => {
                    app.message = "校验失败".to_string();
                    app.validation = ValidationState::Failed(e);
                }
            }
        }
        BgMessage::ProvidersLoaded { providers, active_id } => {
            app.providers = providers;
            app.active_provider_id = active_id;
            // BUG-8/12: 列表变化后重置 cursor，避免越界
            app.provider_cursor = 0;
            app.message = format!("{} 个 Provider", app.providers.len());
        }
        BgMessage::RefreshProviders => {
            // 重新拉取 providers + active provider
            let tx = tx.clone();
            let url = backend_url();
            tokio::spawn(async move {
                let client = crate::api::ApiClient::new(&url);
                let providers = client.list_providers().await.unwrap_or_default();
                let active_id = client
                    .get_active_provider()
                    .await
                    .unwrap_or(None)
                    .map(|p| p.id);
                let _ = tx
                    .send(BgMessage::ProvidersLoaded { providers, active_id })
                    .await;
            });
        }
        BgMessage::ProviderTested { id: _, result } => {
            match result {
                Ok(latency) => {
                    app.provider_test_result = Some(TestResult::Ok(latency));
                    app.message = "连接测试成功".to_string();
                }
                Err(e) => {
                    app.provider_test_result = Some(TestResult::Fail(e));
                    app.message = "连接测试失败".to_string();
                }
            }
        }
        BgMessage::ConfigLoaded(result) => {
            match result {
                Ok(config) => {
                    app.config_data = Some(config);
                    app.message = "配置已加载".to_string();
                }
                Err(_) => {
                    app.message = format!("配置加载失败");
                }
            }
        }
        BgMessage::ChatReply(result) => {
            app.chat_loading = false;
            match result {
                Ok(resp) => {
                    if !resp.reply.is_empty() {
                        app.chat_messages.push(ChatMsg {
                            role: "assistant".to_string(),
                            content: resp.reply,
                        });
                    }
                    app.message = "AI 回复完成".to_string();
                }
                Err(e) => {
                    app.chat_messages.push(ChatMsg {
                        role: "assistant".to_string(),
                        content: format!("错误: {}", e),
                    });
                    app.message = "AI 请求失败".to_string();
                }
            }
        }
    }
}

/// 处理按键
async fn handle_key(app: &mut App, key: KeyCode, tx: &mpsc::Sender<BgMessage>) {
    // Esc：Chat 页聚焦时退出聚焦（恢复全局快捷键）；否则忽略
    if key == KeyCode::Esc {
        if app.chat_focused {
            app.chat_focused = false;
            return;
        }
    }

    // 全局快捷键：仅在 Chat 页未聚焦输入框时生效（否则允许输入 q/1-5/Tab/F2 等字符）
    if !(app.current_tab == Tab::Chat && app.chat_focused) {
        match key {
            KeyCode::Char('q') => { app.quit(); return; }
            KeyCode::Tab => {
                let next = (app.current_tab.index() + 1) % 5;
                if let Some(t) = Tab::from_index(next) {
                    app.switch_tab(t);
                    // 切到 Chat 页自动聚焦
                    if app.current_tab == Tab::Chat { app.chat_focused = true; }
                }
                return;
            }
            KeyCode::BackTab => {
                let prev = if app.current_tab.index() == 0 { 4 } else { app.current_tab.index() - 1 };
                if let Some(t) = Tab::from_index(prev) {
                    app.switch_tab(t);
                    // 切到 Chat 页自动聚焦
                    if app.current_tab == Tab::Chat { app.chat_focused = true; }
                }
                return;
            }
            KeyCode::F(2) => {
                app.fx_enabled = !app.fx_enabled;
                app.message = if app.fx_enabled { "动效已开启" } else { "动效已关闭" }.to_string();
                return;
            }
            KeyCode::F(3) => {
                app.theme = app.theme.toggle();
                app::colors::set_theme(app.theme.idx());
                app.message = format!("主题: {}", app.theme.name());
                theme::save_theme(app.theme);
                return;
            }
            KeyCode::Char(c) if ('1'..='5').contains(&c) => {
                if let Some(t) = Tab::from_index((c as usize) - ('1' as usize)) {
                    app.switch_tab(t);
                    // 切到 Chat 页自动聚焦
                    if app.current_tab == Tab::Chat { app.chat_focused = true; }
                }
                return;
            }
            _ => {}
        }
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
                app.message = format!("正在打开 {}...", p.name);
                let tx = tx.clone();
                let url = backend_url();
                tokio::spawn(async move {
                    let mut client = crate::api::ApiClient::new(&url);
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
                    app.message = "正在校验...".to_string();
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
                app.message = "请先打开项目".to_string();
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

        // ---- Provider 页 ----
        // 进入 Provider 页时自动加载列表
        KeyCode::Down | KeyCode::Char('j') if app.current_tab == Tab::Provider => {
            if !app.providers.is_empty() {
                app.provider_cursor = (app.provider_cursor + 1) % app.providers.len();
            }
        }
        KeyCode::Up | KeyCode::Char('k') if app.current_tab == Tab::Provider => {
            if !app.providers.is_empty() {
                app.provider_cursor = if app.provider_cursor == 0 {
                    app.providers.len() - 1
                } else { app.provider_cursor - 1 };
            }
        }
        KeyCode::Char('t') if app.current_tab == Tab::Provider => {
            if let Some(p) = app.providers.get(app.provider_cursor).cloned() {
                app.message = format!("测试 {}...", p.name);
                app.provider_test_result = None;
                let tx = tx.clone();
                let url = backend_url();
                tokio::spawn(async move {
                    let mut client = crate::api::ApiClient::new(&url);
                    let result = client.test_provider(&p.id).await;
                    let msg = match result {
                        Ok(resp) => {
                            // health 是 dict（如 {"status": "ok", ...}），提取 status 字符串
                            let status = resp
                                .health
                                .as_ref()
                                .and_then(|h| h.get("status"))
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string())
                                .unwrap_or_else(|| {
                                    resp.health
                                        .as_ref()
                                        .and_then(|h| h.as_str())
                                        .map(|s| s.to_string())
                                        .unwrap_or_default()
                                });
                            if status.contains("ok") {
                                BgMessage::ProviderTested { id: p.id, result: Ok("ok".to_string()) }
                            } else {
                                BgMessage::ProviderTested { id: p.id, result: Err(status) }
                            }
                        }
                        Err(e) => BgMessage::ProviderTested { id: p.id, result: Err(e.to_string()) },
                    };
                    let _ = tx.send(msg).await;
                });
            }
        }
        KeyCode::Char('a') if app.current_tab == Tab::Provider => {
            if let Some(p) = app.providers.get(app.provider_cursor).cloned() {
                app.active_provider_id = Some(p.id.clone());
                app.message = format!("已激活 {}", p.name);
                let tx = tx.clone();
                let url = backend_url();
                tokio::spawn(async move {
                    let mut client = crate::api::ApiClient::new(&url);
                    let _ = client.activate_provider(&p.id).await;
                    // 激活后触发重新拉取列表（含 active_id），而非清空列表
                    let _ = tx.send(BgMessage::RefreshProviders).await;
                });
            }
        }
        KeyCode::Char('r') if app.current_tab == Tab::Provider => {
            app.message = "加载 Provider...".to_string();
            let tx = tx.clone();
            let url = backend_url();
            tokio::spawn(async move {
                let client = crate::api::ApiClient::new(&url);
                let providers = client.list_providers().await.unwrap_or_default();
                let active_id = client
                    .get_active_provider()
                    .await
                    .unwrap_or(None)
                    .map(|a| a.id);
                let msg = BgMessage::ProvidersLoaded { providers, active_id };
                let _ = tx.send(msg).await;
            });
        }

        // ---- Config 页 ----
        KeyCode::Char('r') if app.current_tab == Tab::Config => {
            if app.api.project_path().is_some() {
                app.message = "加载配置...".to_string();
                let tx = tx.clone();
                let url = backend_url();
                let path = app.api.project_path().unwrap().to_string();
                tokio::spawn(async move {
                    let mut client = crate::api::ApiClient::new(&url);
                    client.set_project(&path);
                    let result = client.get_full_config().await;
                    let _ = tx.send(BgMessage::ConfigLoaded(result.map_err(|e| e.to_string()))).await;
                });
            } else {
                app.message = "请先打开项目".to_string();
            }
        }

        // ---- Chat 页 ----
        KeyCode::Enter if app.current_tab == Tab::Chat && !app.chat_loading => {
            let msg = app.chat_input.trim().to_string();
            if !msg.is_empty() && app.api.project_path().is_some() {
                app.chat_messages.push(ChatMsg { role: "user".to_string(), content: msg.clone() });
                app.chat_input.clear();
                app.chat_loading = true;
                app.message = "AI 思考中...".to_string();
                let tx = tx.clone();
                let url = backend_url();
                let path = app.api.project_path().unwrap().to_string();
                let history: Vec<ChatMessage> = app.chat_messages.iter().map(|m| ChatMessage {
                    role: m.role.clone(),
                    content: m.content.clone(),
                }).collect();
                tokio::spawn(async move {
                    let mut client = crate::api::ApiClient::new(&url);
                    client.set_project(&path);
                    let result = client.send_chat(&msg, &history).await;
                    let _ = tx.send(BgMessage::ChatReply(result.map_err(|e| e.to_string()))).await;
                });
            }
        }
        KeyCode::Char(c) if app.current_tab == Tab::Chat && app.chat_focused && !app.chat_loading => {
            app.chat_input.push(c);
        }
        KeyCode::Backspace if app.current_tab == Tab::Chat && app.chat_focused && !app.chat_loading => {
            app.chat_input.pop();
        }

        _ => {}
    }
}
