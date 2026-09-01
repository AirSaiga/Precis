//! Precis TUI (Rust + ratatui) — 主入口
//!
//! 架构：同步事件循环 + tokio::spawn 异步 HTTP + mpsc channel 回传结果
//! 渲染循环永不阻塞（HTTP 在后台 task 里跑，结果通过 channel 送回）

// API 响应类型含后端返回但 TUI 暂未展示的字段（icons.rs 的预留常量已清理，不再需要豁免）。
// 这些预留字段不影响运行，抑制 dead_code warning 避免编译输出噪音。
#![allow(dead_code)]

mod api;
mod app;
mod backend;
mod fx;
mod i18n;
mod icons;
mod theme;
mod ui;

use std::io;
use std::path::{Path, PathBuf};
use std::time::Duration;

use anyhow::Result;
use crossterm::event::{self, Event, KeyCode, KeyEventKind};
use crossterm::execute;
use crossterm::terminal::{
    disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen,
};
use ratatui::backend::CrosstermBackend;
use ratatui::Terminal;
use tokio::sync::mpsc;

use crate::api::types::{
    AiChatResponse, ChatMessage, FullConfigResponse, FullValidationResponse, ProviderInfo,
};
use crate::app::{App, ChatMsg, ProviderForm, ProviderTestToast, Tab, TestResult, ValidationState};
use crate::i18n::pick;

fn backend_url() -> String {
    // resolve_backend_url 完成后写入 OnceLock：自拉起模式下后端监听 OS 动态端口，
    // 后续所有后台任务必须复用该地址，否则会误打到默认的 18000
    if let Some(url) = RESOLVED_BACKEND_URL.get() {
        return url.clone();
    }
    std::env::var("PRECIS_BACKEND_URL").unwrap_or_else(|_| "http://127.0.0.1:18000".to_string())
}

/// resolve_backend_url 解析出的最终后端地址（自拉起时为动态端口）
static RESOLVED_BACKEND_URL: std::sync::OnceLock<String> = std::sync::OnceLock::new();

/// 后端地址解析结果
enum ResolvedBackend {
    /// 外部后端（PRECIS_BACKEND_URL 已设置），无需本进程管理
    External(String),
    /// 由本进程拉起的内置后端，_guard 存活期间保持运行
    Managed(backend::BackendHandle),
}

/// 解析后端地址。环境变量优先；未设置则尝试拉起内置后端。
fn resolve_backend_url() -> Result<ResolvedBackend> {
    if let Ok(url) = std::env::var("PRECIS_BACKEND_URL") {
        if !url.is_empty() {
            tracing::info!("使用外部后端: {}", url);
            return Ok(ResolvedBackend::External(url));
        }
    }
    tracing::info!("PRECIS_BACKEND_URL 未设置，尝试拉起内置后端");
    let handle = backend::BackendHandle::start()?;
    Ok(ResolvedBackend::Managed(handle))
}

/// 从 exe 所在目录向上逐级探测是否存在 backend/ 目录（上限 8 级，防病态深路径）。
///
/// 开发态：exe 位于 `<repo>/tui-rust/target/debug/`，向上数级即见 `<repo>/backend/`；
/// 打包态：exe 位于安装目录，祖先链中没有 backend/。
fn is_dev_layout(exe_dir: &Path) -> bool {
    let mut cur = Some(exe_dir);
    let mut depth = 0;
    while let Some(dir) = cur {
        if depth >= 8 {
            break;
        }
        if dir.join("backend").is_dir() {
            return true;
        }
        cur = dir.parent();
        depth += 1;
    }
    false
}

/// 解析工作目录（优先级从高到低）：
///
/// 1. `PRECIS_WORK_DIR` 环境变量（显式指定，最高优先，现状保留）
/// 2. 开发态布局探测：exe 祖先链存在 `backend/`（源码树内）且 `<cwd.parent>/qa_test`
///    存在 → 使用 qa_test（与历史行为一致，仅在探测命中时启用）
/// 3. 打包态回退：用户主目录——打包双击启动时 cwd=安装目录，
///    旧实现 `cwd.parent()/qa_test` 在该场景必然"未发现项目"
/// 4. 主目录不可得的最后兜底：当前目录
///
/// 参数均为注入值以便单元测试（不直接读环境变量/文件系统之外的全局态）。
fn resolve_work_dir(
    cwd: &Path,
    exe_dir: Option<&Path>,
    env_work_dir: Option<&str>,
    home_dir: Option<&Path>,
) -> PathBuf {
    // ① 显式环境变量优先
    if let Some(v) = env_work_dir {
        if !v.is_empty() {
            return PathBuf::from(v);
        }
    }
    // ② 开发态：源码树内存在 qa_test 时沿用旧路径
    if let Some(exe_dir) = exe_dir {
        if is_dev_layout(exe_dir) {
            let project_root = cwd.parent().unwrap_or(cwd);
            let qa_test = project_root.join("qa_test");
            if qa_test.is_dir() {
                return qa_test;
            }
        }
    }
    // ③ 打包态回退到用户主目录
    if let Some(home) = home_dir {
        return home.to_path_buf();
    }
    // ④ 兜底：当前目录
    cwd.to_path_buf()
}

fn scan_work_dir() -> String {
    let cwd = std::env::current_dir().unwrap_or_default();
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()));
    let home = dirs::home_dir();
    let env_val = std::env::var("PRECIS_WORK_DIR").ok();
    resolve_work_dir(
        &cwd,
        exe_dir.as_deref(),
        env_val.as_deref(),
        home.as_deref(),
    )
    .to_string_lossy()
    .to_string()
}

/// 后台任务 → 事件循环的消息
enum BgMessage {
    ProjectOpened {
        name: String,
        path: String,
        success: bool,
    },
    ValidationDone(Result<FullValidationResponse, String>),
    ProvidersLoaded {
        providers: Vec<ProviderInfo>,
        active_id: Option<String>,
    },
    /// Provider 列表加载失败（网络/解析错误，避免静默空表）
    ProvidersLoadFailed(String),
    /// 触发重新拉取 providers + active（无数据）
    RefreshProviders,
    ProviderTested {
        id: String,
        result: Result<String, String>,
    },
    /// 激活 Provider 完成（携带激活前的 active id，失败时用于回滚乐观更新）
    ProviderActivated {
        id: String,
        name: String,
        previous_active: Option<String>,
        result: Result<(), String>,
    },
    /// 新建 Provider 完成（Ok=名称）
    ProviderCreated(Result<String, String>),
    ConfigLoaded(Result<FullConfigResponse, String>),
    ChatReply(Result<AiChatResponse, String>),
}

fn main() -> Result<()> {
    // i18n：启动最早期探测界面语言（必须先于运行时构建——worker 线程的
    // thread_local 依赖 build_runtime 的 on_thread_start 注入，thread_local
    // 本身不跨线程继承）
    crate::i18n::init_from_env();
    let runtime = build_runtime(crate::i18n::lang())?;
    runtime.block_on(async_main())
}

/// 构建生产运行时（等价原 `#[tokio::main]` 的 multi_thread 默认配置）。
///
/// worker 线程启动时把主线程探测到的界面语言注入各自 thread_local：后台任务
/// （打开项目/校验/Provider/Chat 等，均为 tokio::spawn）运行在 worker 线程上，
/// 若无此注入，`api/client.rs` 的 `pick()` 会恒回退默认中文，英文用户的错误
/// 文案与界面语言混排。此注入是语言跨线程传播的唯一途径。
fn build_runtime(lang: crate::i18n::Lang) -> Result<tokio::runtime::Runtime> {
    Ok(tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .on_thread_start(move || crate::i18n::set_lang(lang))
        .build()?)
}

async fn async_main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("warn")),
        )
        .init();

    // 后端地址来源（优先级）：
    // 1. PRECIS_BACKEND_URL 已设置 → 直接用（外部后端 / dev 模式）
    // 2. 未设置 → 尝试拉起内置后端子进程（打包态自包含）
    let (url, _backend_guard) = match resolve_backend_url() {
        Ok(ResolvedBackend::External(url)) => (url, None),
        Ok(ResolvedBackend::Managed(handle)) => {
            let url = format!("http://127.0.0.1:{}", handle.port());
            (url, Some(handle))
        }
        Err(e) => {
            // 内置后端启动失败时回退到默认 URL（让 TUI 以"后端未连接"状态启动，不崩溃）
            tracing::warn!("内置后端启动失败，回退默认地址: {}", e);
            (backend_url(), None)
        }
    };
    // 写入全局，供后续后台任务（打开项目/校验/Provider 等）复用同一地址
    let _ = RESOLVED_BACKEND_URL.set(url.clone());

    let mut app = App::new(&url);

    // 加载持久化主题并应用到 thread_local
    let saved_theme = theme::load_theme();
    app.theme = saved_theme;
    app::colors::set_theme(saved_theme.idx());

    match try_init(&mut app).await {
        Ok(()) => {}
        Err(e) => {
            app.message = pick("后端未连接", "Backend not connected").to_string();
            app.backend_connected = false;
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
    app.backend_connected = true;
    app.message = pick("后端已连接", "Backend connected").to_string();

    let work_dir = scan_work_dir();
    match app.api.scan_projects(&work_dir).await {
        Ok(projects) => {
            if projects.is_empty() {
                // 首次扫描为空（打包态默认落到主目录等场景）时给出明确指引
                app.message = pick(
                    "未发现项目，可设 PRECIS_WORK_DIR 指定目录",
                    "No projects found. Set PRECIS_WORK_DIR to choose a directory",
                )
                .to_string();
            } else {
                app.message = format!(
                    "{} {} {}",
                    pick("找到", "Found"),
                    projects.len(),
                    pick("个项目", "projects")
                );
            }
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
                    handle_key(app, key.code, key.modifiers, tx).await;
                }
            }
            // 排空残留事件防止重复触发——但 Chat 聚焦输入时需要保留连续输入
            if !(app.current_tab == Tab::Chat && app.chat_focused) {
                while event::poll(Duration::from_millis(0)).unwrap_or(false) {
                    let _ = event::read();
                }
            }
        }

        if app.should_quit {
            break;
        }
    }
    Ok(())
}

/// 后台拉取 Provider 列表（失败时回传可见错误，而非静默空表）
fn spawn_load_providers(tx: &mpsc::Sender<BgMessage>) {
    let tx = tx.clone();
    let url = backend_url();
    tokio::spawn(async move {
        let client = crate::api::ApiClient::new(&url);
        let msg = match client.list_providers().await {
            Ok(providers) => {
                let active_id = client
                    .get_active_provider()
                    .await
                    .unwrap_or(None)
                    .map(|p| p.id);
                BgMessage::ProvidersLoaded {
                    providers,
                    active_id,
                }
            }
            Err(e) => BgMessage::ProvidersLoadFailed(e.to_string()),
        };
        let _ = tx.send(msg).await;
    });
}

/// 处理后台任务返回的消息
fn handle_bg_message(app: &mut App, msg: BgMessage, tx: &mpsc::Sender<BgMessage>) {
    match msg {
        BgMessage::ProjectOpened {
            name,
            path,
            success,
        } => {
            app.opening_project = false;
            if success {
                app.api.set_project(&path);
                app.project_name = Some(name);
                app.message = pick("项目已打开", "Project opened").to_string();
                app.switch_tab(Tab::Validation);
                app.validation = ValidationState::Idle;
                // BUG-8/17: 打开项目后重置错误列表 cursor，避免越界
                app.error_cursor = 0;
            } else {
                app.message = pick("打开失败", "Failed to open").to_string();
            }
        }
        BgMessage::ValidationDone(result) => {
            match result {
                Ok(resp) => {
                    // error 字段有值 = 执行器初始化失败或运行异常（真正的崩溃）
                    if let Some(err_msg) = &resp.error {
                        if !err_msg.is_empty() {
                            app.message = pick("校验执行异常", "Validation run failed").to_string();
                            app.validation = ValidationState::Failed(err_msg.clone());
                            return;
                        }
                    }
                    // 正常校验结果（success=false 只代表"有校验错误"，不是执行失败）
                    let err_count = resp.summary.total_error_count;
                    app.message = format!(
                        "{}: {} {}, {}ms",
                        pick("完成", "Done"),
                        err_count,
                        pick("个错误", "errors"),
                        resp.summary.duration_ms
                    );
                    app.validation = ValidationState::Done(Box::new(resp));
                }
                Err(e) => {
                    app.message = pick("校验失败", "Validation failed").to_string();
                    app.validation = ValidationState::Failed(e);
                }
            }
        }
        BgMessage::ProvidersLoaded {
            providers,
            active_id,
        } => {
            app.providers = providers;
            app.active_provider_id = active_id;
            // BUG-8/12: 列表变化后重置 cursor，避免越界
            app.provider_cursor = 0;
            app.message = format!(
                "{} {}",
                app.providers.len(),
                pick("个 Provider", "providers")
            );
        }
        BgMessage::ProvidersLoadFailed(e) => {
            app.message = format!(
                "{}: {}",
                pick("Provider 加载失败", "Failed to load providers"),
                e
            );
        }
        BgMessage::ProviderCreated(result) => {
            match result {
                Ok(name) => {
                    app.provider_form = None;
                    app.message = format!("{} {}", pick("已创建", "Created"), name);
                    spawn_load_providers(tx);
                }
                Err(e) => {
                    // 表单保留，用户可修正后重试；解除 in-flight 守卫，允许再次提交
                    if let Some(form) = app.provider_form.as_mut() {
                        form.submitting = false;
                    }
                    app.message = e;
                }
            }
        }
        BgMessage::RefreshProviders => {
            // 重新拉取 providers + active provider
            spawn_load_providers(tx);
        }
        BgMessage::ProviderActivated {
            id,
            name,
            previous_active,
            result,
        } => match result {
            Ok(()) => {
                app.active_provider_id = Some(id);
                app.message = format!("{} {}", pick("已激活", "Activated"), name);
                // 激活后触发重新拉取列表（含 active_id），而非清空列表
                spawn_load_providers(tx);
            }
            Err(e) => {
                // 回滚乐观更新，保持本地状态与后端真实状态一致
                app.active_provider_id = previous_active;
                app.message = format!("{}: {}", pick("激活失败", "Activation failed"), e);
            }
        },
        BgMessage::ProviderTested { id, result } => {
            // toast 绑定被测 provider id + 产生时刻（驱动 TTL 消隐与光标错配隐藏）
            match result {
                Ok(latency) => {
                    app.provider_test_result = Some(ProviderTestToast {
                        provider_id: id,
                        result: TestResult::Ok(latency),
                        at_frame: app.frame_count,
                    });
                    app.message = pick("连接测试成功", "Connection test passed").to_string();
                }
                Err(e) => {
                    app.provider_test_result = Some(ProviderTestToast {
                        provider_id: id,
                        result: TestResult::Fail(e),
                        at_frame: app.frame_count,
                    });
                    app.message = pick("连接测试失败", "Connection test failed").to_string();
                }
            }
        }
        BgMessage::ConfigLoaded(result) => match result {
            Ok(config) => {
                app.config_data = Some(config);
                app.message = pick("配置已加载", "Config loaded").to_string();
            }
            Err(_) => {
                app.message = pick("配置加载失败", "Failed to load config").to_string();
            }
        },
        BgMessage::ChatReply(result) => {
            app.chat_loading = false;
            // 新回复到达自动回到底部
            app.chat_scroll = 0;
            match result {
                Ok(resp) => {
                    if !resp.reply.is_empty() {
                        app.chat_messages.push(ChatMsg {
                            role: "assistant".to_string(),
                            content: resp.reply,
                        });
                    }
                    app.message = pick("AI 回复完成", "AI reply done").to_string();
                }
                Err(e) => {
                    app.chat_messages.push(ChatMsg {
                        role: "assistant".to_string(),
                        content: format!("{}: {}", pick("错误", "Error"), e),
                    });
                    app.message = pick("AI 请求失败", "AI request failed").to_string();
                }
            }
        }
    }
}

/// 由当前对话消息构造发送给后端的 history。
///
/// 调用方必须在 push 本次新用户消息**之前**调用（后端组装顺序为
/// [system]+history+[user]，history 含本条会导致消息重复）。
fn build_chat_history(messages: &[ChatMsg]) -> Vec<ChatMessage> {
    messages
        .iter()
        .map(|m| ChatMessage {
            role: m.role.clone(),
            content: m.content.clone(),
        })
        .collect()
}

/// 处理按键
async fn handle_key(
    app: &mut App,
    key: KeyCode,
    modifiers: crossterm::event::KeyModifiers,
    tx: &mpsc::Sender<BgMessage>,
) {
    // Ctrl+C / Ctrl+D：任何上下文下都退出（跨平台友好）
    if modifiers.contains(crossterm::event::KeyModifiers::CONTROL) {
        match key {
            KeyCode::Char('c') | KeyCode::Char('C') | KeyCode::Char('d') | KeyCode::Char('D') => {
                app.quit();
                return;
            }
            _ => {}
        }
    }

    // 新建 Provider 表单打开时：拦截全部按键（Ctrl+C/Ctrl+D 已在上方处理）
    if app.provider_form.is_some() {
        handle_provider_form_key(app, key, tx);
        return;
    }

    // Esc：Chat 页聚焦时退出聚焦（恢复全局快捷键）；否则忽略
    if key == KeyCode::Esc && app.chat_focused {
        app.chat_focused = false;
        return;
    }

    // Tab/BackTab 始终生效（导航不是输入内容）；数字直达键在 Chat 输入框聚焦时让位给文本输入（否则 1-5 打不进消息）
    match key {
        KeyCode::Tab => {
            let next = (app.current_tab.index() + 1) % 5;
            if let Some(t) = Tab::from_index(next) {
                app.switch_tab(t);
                auto_load_on_tab_switch(app, tx);
                if app.current_tab == Tab::Chat {
                    app.chat_focused = true;
                }
            }
            return;
        }
        KeyCode::BackTab => {
            let prev = if app.current_tab.index() == 0 {
                4
            } else {
                app.current_tab.index() - 1
            };
            if let Some(t) = Tab::from_index(prev) {
                app.switch_tab(t);
                auto_load_on_tab_switch(app, tx);
                if app.current_tab == Tab::Chat {
                    app.chat_focused = true;
                }
            }
            return;
        }
        KeyCode::Char(c)
            if ('1'..='5').contains(&c) && !(app.current_tab == Tab::Chat && app.chat_focused) =>
        {
            if let Some(t) = Tab::from_index((c as usize) - ('1' as usize)) {
                app.switch_tab(t);
                auto_load_on_tab_switch(app, tx);
                if app.current_tab == Tab::Chat {
                    app.chat_focused = true;
                }
            }
            return;
        }
        _ => {}
    }

    // 其他全局快捷键：仅在 Chat 页未聚焦输入框时生效
    if !(app.current_tab == Tab::Chat && app.chat_focused) {
        match key {
            KeyCode::Char('q') | KeyCode::Char('Q') => {
                app.quit();
                return;
            }
            KeyCode::F(2) => {
                app.fx_enabled = !app.fx_enabled;
                app.message = if app.fx_enabled {
                    pick("动效已开启", "FX on")
                } else {
                    pick("动效已关闭", "FX off")
                }
                .to_string();
                return;
            }
            KeyCode::F(3) => {
                app.theme = app.theme.toggle();
                app::colors::set_theme(app.theme.idx());
                app.message = format!("{}: {}", pick("主题", "Theme"), app.theme.name());
                theme::save_theme(app.theme);
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
                } else {
                    app.selected_project - 1
                };
            }
        }
        // 打开项目（异步 spawn）
        KeyCode::Enter if app.current_tab == Tab::Dashboard && !app.opening_project => {
            if let Some(p) = app.projects.get(app.selected_project).cloned() {
                app.opening_project = true;
                app.message = format!("{} {}...", pick("正在打开", "Opening"), p.name);
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
                    app.message = pick("正在校验...", "Validating...").to_string();
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
                app.message = pick("请先打开项目", "Open a project first").to_string();
            }
        }

        // Validation 错误表格滚动
        KeyCode::Down | KeyCode::Char('j') if app.current_tab == Tab::Validation => {
            if let ValidationState::Done(resp) = &app.validation {
                // 上限与渲染端（ui/validation.rs）钳制一致：错误表只渲染前
                // MAX_ERRORS 条，cursor 越过它会"已到末尾但高亮停滞"
                let max = resp
                    .errors
                    .len()
                    .saturating_sub(1)
                    .min(ui::validation::MAX_ERRORS - 1);
                if app.error_cursor < max {
                    app.error_cursor += 1;
                }
            }
        }
        KeyCode::Up | KeyCode::Char('k') if app.current_tab == Tab::Validation => {
            if app.error_cursor > 0 {
                app.error_cursor -= 1;
            }
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
                } else {
                    app.provider_cursor - 1
                };
            }
        }
        KeyCode::Char('t') if app.current_tab == Tab::Provider => {
            if let Some(p) = app.providers.get(app.provider_cursor).cloned() {
                app.message = format!("{} {}...", pick("测试", "Testing"), p.name);
                app.provider_test_result = None;
                let tx = tx.clone();
                let url = backend_url();
                tokio::spawn(async move {
                    let client = crate::api::ApiClient::new(&url);
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
                                BgMessage::ProviderTested {
                                    id: p.id,
                                    result: Ok("ok".to_string()),
                                }
                            } else {
                                BgMessage::ProviderTested {
                                    id: p.id,
                                    result: Err(status),
                                }
                            }
                        }
                        Err(e) => BgMessage::ProviderTested {
                            id: p.id,
                            result: Err(e.to_string()),
                        },
                    };
                    let _ = tx.send(msg).await;
                });
            }
        }
        KeyCode::Char('a') if app.current_tab == Tab::Provider => {
            if let Some(p) = app.providers.get(app.provider_cursor).cloned() {
                // 乐观更新：立即高亮为激活态，后台确认失败时在 BgMessage::ProviderActivated
                // 中回滚（此前 `let _ =` 吞错误导致失败也显示"已激活"）
                let previous_active = app.active_provider_id.clone();
                app.active_provider_id = Some(p.id.clone());
                app.message = format!("{} {}...", pick("正在激活", "Activating"), p.name);
                let tx = tx.clone();
                let url = backend_url();
                tokio::spawn(async move {
                    let client = crate::api::ApiClient::new(&url);
                    let result = client
                        .activate_provider(&p.id)
                        .await
                        .map_err(|e| e.to_string());
                    let _ = tx
                        .send(BgMessage::ProviderActivated {
                            id: p.id,
                            name: p.name,
                            previous_active,
                            result,
                        })
                        .await;
                });
            }
        }
        KeyCode::Char('r') if app.current_tab == Tab::Provider => {
            app.message = pick("加载 Provider...", "Loading providers...").to_string();
            spawn_load_providers(tx);
        }

        // 新建 Provider 表单
        KeyCode::Char('n') if app.current_tab == Tab::Provider => {
            app.provider_form = Some(ProviderForm::new());
            app.message = pick("新建 Provider", "New provider").to_string();
        }

        // ---- Config 页 ----
        KeyCode::Char('r') if app.current_tab == Tab::Config => {
            if app.api.project_path().is_some() {
                app.message = pick("加载配置...", "Loading config...").to_string();
                let tx = tx.clone();
                let url = backend_url();
                let path = app.api.project_path().unwrap().to_string();
                tokio::spawn(async move {
                    let mut client = crate::api::ApiClient::new(&url);
                    client.set_project(&path);
                    let result = client.get_full_config().await;
                    let _ = tx
                        .send(BgMessage::ConfigLoaded(result.map_err(|e| e.to_string())))
                        .await;
                });
            } else {
                app.message = pick("请先打开项目", "Open a project first").to_string();
            }
        }

        // ---- Chat 页 ----
        // 历史回看：PgUp 向上翻 10 行 / PgDn 向下翻（不产生文本，输入框聚焦与否都可用）
        KeyCode::PageUp if app.current_tab == Tab::Chat => {
            app.chat_scroll = app.chat_scroll.saturating_add(10);
        }
        KeyCode::PageDown if app.current_tab == Tab::Chat => {
            app.chat_scroll = app.chat_scroll.saturating_sub(10);
        }
        KeyCode::Enter if app.current_tab == Tab::Chat && !app.chat_loading => {
            // 未聚焦：Enter = 聚焦输入框（与空态提示 "Enter 聚焦输入" 一致），不触发发送
            if !app.chat_focused {
                app.chat_focused = true;
                return;
            }
            let msg = app.chat_input.trim().to_string();
            if !msg.is_empty() && app.api.project_path().is_some() {
                // 先构造 history 再 push 本条用户消息：后端按 [system]+history+[user]
                // 组装请求，history 若已含本条会导致该消息重复发送两份。
                // push 之后消息留在 chat_messages 中，后续轮次的 history 仍会带上它。
                let history = build_chat_history(&app.chat_messages);
                app.chat_messages.push(ChatMsg {
                    role: "user".to_string(),
                    content: msg.clone(),
                });
                // 发送新消息自动回到底部（停在最新消息）
                app.chat_scroll = 0;
                app.chat_input.clear();
                app.chat_loading = true;
                app.message = pick("AI 思考中...", "AI thinking...").to_string();
                let tx = tx.clone();
                let url = backend_url();
                let path = app.api.project_path().unwrap().to_string();
                tokio::spawn(async move {
                    let mut client = crate::api::ApiClient::new(&url);
                    client.set_project(&path);
                    let result = client.send_chat(&msg, &history).await;
                    let _ = tx
                        .send(BgMessage::ChatReply(result.map_err(|e| e.to_string())))
                        .await;
                });
            }
        }
        KeyCode::Char(c)
            if app.current_tab == Tab::Chat && app.chat_focused && !app.chat_loading =>
        {
            app.chat_input.push(c);
        }
        KeyCode::Backspace | KeyCode::Delete
            if app.current_tab == Tab::Chat && app.chat_focused && !app.chat_loading =>
        {
            app.chat_input.pop();
        }

        _ => {}
    }
}

/// 新建 Provider 表单的按键处理（表单打开时独占输入）
fn handle_provider_form_key(app: &mut App, key: KeyCode, tx: &mpsc::Sender<BgMessage>) {
    // 控制键先行（避免与表单的 mutable 借用冲突）
    match key {
        KeyCode::Esc => {
            app.provider_form = None;
            app.message = pick("已取消新建", "Creation cancelled").to_string();
            return;
        }
        KeyCode::Enter => {
            let Some(form) = app.provider_form.as_ref() else {
                return;
            };
            // in-flight 守卫：后台创建请求未返回期间忽略再次提交（防双击双建 Provider）
            if form.submitting {
                return;
            }
            if !form.valid() {
                app.message = pick(
                    "名称 / Base URL / 模型 为必填",
                    "Name / Base URL / Model are required",
                )
                .to_string();
                return;
            }
            let req = crate::api::types::CreateProviderRequest {
                name: form.name.trim().to_string(),
                provider_type: form.ptype.clone(),
                base_url: form.base_url.trim().to_string(),
                api_key: if form.api_key.trim().is_empty() {
                    None
                } else {
                    Some(form.api_key.trim().to_string())
                },
                model: form.model.trim().to_string(),
            };
            if let Some(form) = app.provider_form.as_mut() {
                form.submitting = true;
            }
            app.message = pick("创建 Provider...", "Creating provider...").to_string();
            let tx = tx.clone();
            let url = backend_url();
            tokio::spawn(async move {
                let client = crate::api::ApiClient::new(&url);
                let msg = match client.create_provider(&req).await {
                    Ok(p) => BgMessage::ProviderCreated(Ok(p.name)),
                    Err(e) => BgMessage::ProviderCreated(Err(e.to_string())),
                };
                let _ = tx.send(msg).await;
            });
            return;
        }
        _ => {}
    }

    // 其余按键：字段导航 / 类型切换 / 文本编辑
    let Some(form) = app.provider_form.as_mut() else {
        return;
    };
    match key {
        KeyCode::Down | KeyCode::Tab => {
            form.field = (form.field + 1) % 5;
        }
        KeyCode::Up | KeyCode::BackTab => {
            form.field = if form.field == 0 { 4 } else { form.field - 1 };
        }
        KeyCode::Left | KeyCode::Right if form.field == 1 => {
            form.ptype = if form.ptype == "openai" {
                "ollama".to_string()
            } else {
                "openai".to_string()
            };
        }
        KeyCode::Backspace | KeyCode::Delete => {
            if let Some(t) = form.text_mut() {
                t.pop();
            }
        }
        KeyCode::Char(c) => {
            if let Some(t) = form.text_mut() {
                t.push(c);
            }
        }
        _ => {}
    }
}

/// 切换 tab 时自动加载数据（Provider 列表、Config 配置）
fn auto_load_on_tab_switch(app: &mut App, tx: &mpsc::Sender<BgMessage>) {
    match app.current_tab {
        Tab::Provider if app.providers.is_empty() => {
            app.message = pick("加载 Provider...", "Loading providers...").to_string();
            spawn_load_providers(tx);
        }
        Tab::Config if app.config_data.is_none() && app.api.project_path().is_some() => {
            app.message = pick("加载配置...", "Loading config...").to_string();
            let tx = tx.clone();
            let url = backend_url();
            let path = app.api.project_path().unwrap().to_string();
            tokio::spawn(async move {
                let mut client = crate::api::ApiClient::new(&url);
                client.set_project(&path);
                let result = client.get_full_config().await;
                let _ = tx
                    .send(BgMessage::ConfigLoaded(result.map_err(|e| e.to_string())))
                    .await;
            });
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crossterm::event::KeyModifiers;

    /// 回归：build_runtime 的 worker 线程必须继承主线程语言——
    /// tokio::spawn 的任务在 worker 线程执行，thread_local 语言若未注入，
    /// pick 恒回退默认中文（英文用户错误文案混排，2026-08-29 实证缺陷）
    #[test]
    fn runtime_workers_inherit_ui_lang() {
        let rt = build_runtime(crate::i18n::Lang::EnUs).expect("runtime");
        let got = rt.block_on(async {
            tokio::spawn(async { crate::i18n::pick("中文", "English") })
                .await
                .expect("join")
        });
        assert_eq!(got, "English", "spawn 内 pick 应读到注入的语言");
    }

    /// backend_url 必须优先返回 resolve 后的地址（自拉起模式为动态端口，而非默认 18000）
    #[test]
    fn test_backend_url_prefers_resolved() {
        let _ = RESOLVED_BACKEND_URL.set("http://127.0.0.1:63281".to_string());
        assert_eq!(backend_url(), "http://127.0.0.1:63281");
    }

    /// Chat 聚焦输入框时数字 1-5 应作为文本输入，不被全局直达快捷键吞掉
    #[tokio::test]
    async fn chat_input_accepts_digits_when_focused() {
        let mut app = App::new("http://127.0.0.1:1");
        let (tx, _rx) = mpsc::channel::<BgMessage>(4);
        app.current_tab = Tab::Chat;
        app.chat_focused = true;
        handle_key(&mut app, KeyCode::Char('3'), KeyModifiers::NONE, &tx).await;
        handle_key(&mut app, KeyCode::Char('1'), KeyModifiers::NONE, &tx).await;
        assert_eq!(app.chat_input, "31", "数字应进入输入框");
        assert_eq!(app.current_tab, Tab::Chat, "不应触发 tab 直达切换");
    }

    /// Chat 未聚焦时数字直达键仍应正常切换 tab（且不写入输入框）
    #[tokio::test]
    async fn digit_shortcut_still_works_when_chat_unfocused() {
        let mut app = App::new("http://127.0.0.1:1");
        let (tx, _rx) = mpsc::channel::<BgMessage>(4);
        app.current_tab = Tab::Chat;
        app.chat_focused = false;
        handle_key(&mut app, KeyCode::Char('3'), KeyModifiers::NONE, &tx).await;
        assert_eq!(app.current_tab, Tab::Provider, "'3' 应直达 Provider 页");
        assert!(app.chat_input.is_empty(), "未聚焦时数字不应写入输入框");
    }

    /// Chat 未聚焦时 Enter = 聚焦输入框（与空态提示一致），即使输入非空也不发送
    #[tokio::test]
    async fn enter_focuses_chat_input_when_unfocused() {
        let mut app = App::new("http://127.0.0.1:1");
        let (tx, _rx) = mpsc::channel::<BgMessage>(4);
        app.current_tab = Tab::Chat;
        app.chat_focused = false;
        // 输入非空 + 已有项目路径：旧实现会误发送，新实现只聚焦
        app.chat_input = "hi".to_string();
        app.api.set_project("/tmp/x");
        handle_key(&mut app, KeyCode::Enter, KeyModifiers::NONE, &tx).await;
        assert!(app.chat_focused, "Enter 应聚焦输入框");
        assert!(app.chat_messages.is_empty(), "未聚焦时 Enter 不应发送消息");
        assert_eq!(app.chat_input, "hi", "输入内容应保持不变");
    }

    /// Chat 聚焦 + 有项目路径时 Enter 应发送消息并进入 loading
    #[tokio::test]
    async fn enter_sends_when_focused() {
        let mut app = App::new("http://127.0.0.1:1");
        let (tx, _rx) = mpsc::channel::<BgMessage>(4);
        app.current_tab = Tab::Chat;
        app.chat_focused = true;
        app.api.set_project("/tmp/x");
        app.chat_input = "hi".to_string();
        handle_key(&mut app, KeyCode::Enter, KeyModifiers::NONE, &tx).await;
        assert_eq!(app.chat_messages.len(), 1, "应新增一条用户消息");
        assert_eq!(app.chat_messages[0].role, "user");
        assert_eq!(app.chat_messages[0].content, "hi");
        assert!(app.chat_input.is_empty(), "发送后输入框应清空");
        assert!(app.chat_loading, "发送后应进入 loading 状态");
    }

    /// Chat 页 PgUp/PgDn 调整回看行数（聚焦输入框时也可用），PgDn saturating 到 0 不下溢
    #[tokio::test]
    async fn chat_pageup_pagedown_adjusts_scroll() {
        let mut app = App::new("http://127.0.0.1:1");
        let (tx, _rx) = mpsc::channel::<BgMessage>(4);
        app.current_tab = Tab::Chat;
        app.chat_focused = true; // 聚焦输入框时 PgUp/PgDn 也不应被吞掉
        handle_key(&mut app, KeyCode::PageUp, KeyModifiers::NONE, &tx).await;
        handle_key(&mut app, KeyCode::PageUp, KeyModifiers::NONE, &tx).await;
        assert_eq!(app.chat_scroll, 20, "两次 PgUp 应回看 20 行");
        handle_key(&mut app, KeyCode::PageDown, KeyModifiers::NONE, &tx).await;
        assert_eq!(app.chat_scroll, 10, "一次 PgDn 应回退到 10 行");
        handle_key(&mut app, KeyCode::PageDown, KeyModifiers::NONE, &tx).await;
        handle_key(&mut app, KeyCode::PageDown, KeyModifiers::NONE, &tx).await;
        handle_key(&mut app, KeyCode::PageDown, KeyModifiers::NONE, &tx).await;
        assert_eq!(app.chat_scroll, 0, "多次 PgDn 应 saturating 到 0 不下溢");
    }

    /// Chat 聚焦 + 有项目路径时 Enter 发送消息应把回看状态重置回底部
    #[tokio::test]
    async fn chat_send_resets_scroll() {
        let mut app = App::new("http://127.0.0.1:1");
        let (tx, _rx) = mpsc::channel::<BgMessage>(4);
        app.current_tab = Tab::Chat;
        app.chat_focused = true;
        app.api.set_project("/tmp/x");
        app.chat_input = "hi".to_string();
        app.chat_scroll = 8;
        handle_key(&mut app, KeyCode::Enter, KeyModifiers::NONE, &tx).await;
        assert_eq!(app.chat_messages.len(), 1, "应发送一条用户消息");
        assert_eq!(app.chat_scroll, 0, "发送后应回到底部（停在最新消息）");
    }

    /// Provider 测试结果 toast 应绑定被测 provider id 与产生时的 frame_count
    #[tokio::test]
    async fn provider_test_result_binds_id_and_frame() {
        let mut app = App::new("http://127.0.0.1:1");
        let (tx, _rx) = mpsc::channel::<BgMessage>(4);
        app.frame_count = 42;
        handle_bg_message(
            &mut app,
            BgMessage::ProviderTested {
                id: "a".to_string(),
                result: Ok("ok".to_string()),
            },
            &tx,
        );
        let t = app.provider_test_result.expect("应记录测试结果 toast");
        assert_eq!(t.provider_id, "a", "toast 应绑定被测 provider id");
        assert_eq!(t.at_frame, 42, "toast 应记录产生时的 frame_count");
        assert!(matches!(t.result, TestResult::Ok(_)), "结果应为 Ok");
    }

    /// 构造带指定数量校验错误的 Done 状态（错误条目各字段全默认填充）
    fn make_validation_done(error_count: usize) -> ValidationState {
        ValidationState::Done(Box::new(FullValidationResponse {
            success: true,
            summary: crate::api::types::ValidationSummary {
                files_total: 1,
                files_loaded: 1,
                tables_loaded: 1,
                loading_error_count: 0,
                format_error_count: error_count as u32,
                constraint_error_count: 0,
                total_error_count: error_count as u32,
                duration_ms: 1,
                interrupted: false,
            },
            errors: (0..error_count)
                .map(|i| crate::api::types::ValidationErrorItem {
                    stage: "format".to_string(),
                    error_type: "type".to_string(),
                    message: format!("err {i}"),
                    table: "t".to_string(),
                    column: "c".to_string(),
                    row_index: None,
                    source_path: "s".to_string(),
                })
                .collect(),
            statistics: None,
            error: None,
        }))
    }

    /// Chat history 必须在 push 本条用户消息之前构造：
    /// 后端组装 [system]+history+[user]，history 含本条会导致消息重复两份；
    /// 而 push 后消息留在 chat_messages，后续轮次的 history 仍需包含它
    #[test]
    fn chat_history_built_before_push_excludes_pending_message() {
        let mut app = App::new("http://127.0.0.1:1");
        app.chat_messages.push(ChatMsg {
            role: "user".to_string(),
            content: "a".to_string(),
        });
        app.chat_messages.push(ChatMsg {
            role: "assistant".to_string(),
            content: "b".to_string(),
        });

        // 复现 handle_key Enter 的发送顺序：先取 history，再 push 本条消息
        let history = build_chat_history(&app.chat_messages);
        app.chat_messages.push(ChatMsg {
            role: "user".to_string(),
            content: "c".to_string(),
        });

        assert_eq!(history.len(), 2, "发送时的 history 不应包含本次新消息");
        assert!(
            history.iter().all(|m| m.content != "c"),
            "message 已单独传给后端，history 再含它会重复"
        );
        // 后续轮次：本轮消息已在历史中，应被完整带上
        assert_eq!(
            build_chat_history(&app.chat_messages).len(),
            3,
            "后续轮次的 history 应包含此前所有消息"
        );
    }

    /// 通过 handle_key 发送后，本轮消息应保留在 chat_messages 中（后续轮次 history 需要）
    #[tokio::test]
    async fn chat_send_keeps_message_for_subsequent_rounds() {
        let mut app = App::new("http://127.0.0.1:1");
        let (tx, _rx) = mpsc::channel::<BgMessage>(4);
        app.current_tab = Tab::Chat;
        app.chat_focused = true;
        app.api.set_project("/tmp/x");
        app.chat_messages.push(ChatMsg {
            role: "user".to_string(),
            content: "old".to_string(),
        });
        app.chat_input = "new".to_string();
        handle_key(&mut app, KeyCode::Enter, KeyModifiers::NONE, &tx).await;
        assert_eq!(app.chat_messages.len(), 2, "旧消息 + 新消息都应在历史中");
        assert_eq!(app.chat_messages[0].content, "old");
        assert_eq!(app.chat_messages[1].content, "new");
    }

    /// Provider 激活失败：乐观更新应回滚到激活前的 provider，且不得显示"已激活"
    #[tokio::test]
    async fn provider_activation_failure_rolls_back_optimistic_update() {
        let mut app = App::new("http://127.0.0.1:1");
        let (tx, _rx) = mpsc::channel::<BgMessage>(4);
        app.active_provider_id = Some("old".to_string());
        // 复现 'a' 键的乐观更新：先置为新 id
        app.active_provider_id = Some("new".to_string());

        handle_bg_message(
            &mut app,
            BgMessage::ProviderActivated {
                id: "new".to_string(),
                name: "P".to_string(),
                previous_active: Some("old".to_string()),
                result: Err("500 Internal Server Error".to_string()),
            },
            &tx,
        );
        assert_eq!(
            app.active_provider_id.as_deref(),
            Some("old"),
            "激活失败应回滚到之前的 provider"
        );
        assert!(!app.message.contains("已激活"), "失败不得显示已激活");
        assert!(app.message.contains("500"), "失败提示应带出错误信息");
    }

    /// Provider 激活成功：确认新 id 为激活态
    #[tokio::test]
    async fn provider_activation_success_confirms_active_id() {
        let mut app = App::new("http://127.0.0.1:1");
        let (tx, _rx) = mpsc::channel::<BgMessage>(4);
        app.active_provider_id = Some("old".to_string());

        handle_bg_message(
            &mut app,
            BgMessage::ProviderActivated {
                id: "new".to_string(),
                name: "P".to_string(),
                previous_active: Some("old".to_string()),
                result: Ok(()),
            },
            &tx,
        );
        assert_eq!(
            app.active_provider_id.as_deref(),
            Some("new"),
            "激活成功应保持新 provider 为激活态"
        );
    }

    /// 构造可通过 valid() 校验的 Provider 新建表单
    fn valid_provider_form() -> ProviderForm {
        let mut form = ProviderForm::new();
        form.name = "P".to_string();
        form.base_url = "http://127.0.0.1:9".to_string();
        form.model = "m".to_string();
        form
    }

    /// Provider 新建表单 in-flight 守卫：后台返回前二次 Enter 不得发出第二个创建请求
    /// （防双击双建 Provider）
    #[tokio::test]
    async fn provider_form_double_enter_sends_only_one_request() {
        let mut app = App::new("http://127.0.0.1:1");
        let (tx, mut rx) = mpsc::channel::<BgMessage>(8);
        app.provider_form = Some(valid_provider_form());

        // 第一次 Enter：发出创建请求并置 in-flight 标志
        handle_provider_form_key(&mut app, KeyCode::Enter, &tx);
        assert!(
            app.provider_form.as_ref().unwrap().submitting,
            "提交后应置 in-flight 标志"
        );

        // 模拟后台慢返回：请求未回来期间再次 Enter（双击）
        handle_provider_form_key(&mut app, KeyCode::Enter, &tx);

        // 排空 channel：只应有第一个请求的回执
        drop(tx);
        let drain = async {
            let mut created = 0usize;
            while let Some(msg) = rx.recv().await {
                if matches!(msg, BgMessage::ProviderCreated(_)) {
                    created += 1;
                }
            }
            created
        };
        let created = tokio::time::timeout(std::time::Duration::from_secs(10), drain)
            .await
            .expect("后台请求应在超时前返回");
        assert_eq!(
            created, 1,
            "in-flight 期间二次 Enter 不应发出第二个创建请求"
        );
    }

    /// Provider 创建失败：表单保留且 in-flight 守卫解除，用户可修正后再次提交
    #[tokio::test]
    async fn provider_form_submit_guard_resets_after_failure() {
        let mut app = App::new("http://127.0.0.1:1");
        let (tx, _rx) = mpsc::channel::<BgMessage>(4);
        app.provider_form = Some(valid_provider_form());
        handle_provider_form_key(&mut app, KeyCode::Enter, &tx);
        assert!(app.provider_form.as_ref().unwrap().submitting);

        handle_bg_message(
            &mut app,
            BgMessage::ProviderCreated(Err("boom".to_string())),
            &tx,
        );
        let form = app
            .provider_form
            .as_ref()
            .expect("创建失败后表单应保留供重试");
        assert!(!form.submitting, "失败后应解除 in-flight 守卫允许重试");
        assert!(app.message.contains("boom"), "失败提示应带出错误信息");
    }

    /// 错误 cursor 增长必须钳制在渲染上限（MAX_ERRORS-1）内：
    /// 错误表只渲染前 MAX_ERRORS 条，cursor 越过后高亮会停滞
    #[tokio::test]
    async fn error_cursor_clamped_to_render_limit() {
        let mut app = App::new("http://127.0.0.1:1");
        let (tx, _rx) = mpsc::channel::<BgMessage>(4);
        app.current_tab = Tab::Validation;
        app.validation = make_validation_done(600);
        // 连按 600 次 Down（超过 MAX_ERRORS）
        for _ in 0..600 {
            handle_key(&mut app, KeyCode::Down, KeyModifiers::NONE, &tx).await;
        }
        assert_eq!(
            app.error_cursor,
            ui::validation::MAX_ERRORS - 1,
            "cursor 不得超过渲染上限（第 499 条）"
        );
    }

    /// 错误数少于 MAX_ERRORS 时，cursor 仍可走到最后一条
    #[tokio::test]
    async fn error_cursor_reaches_last_error_below_render_limit() {
        let mut app = App::new("http://127.0.0.1:1");
        let (tx, _rx) = mpsc::channel::<BgMessage>(4);
        app.current_tab = Tab::Validation;
        app.validation = make_validation_done(3);
        for _ in 0..10 {
            handle_key(&mut app, KeyCode::Down, KeyModifiers::NONE, &tx).await;
        }
        assert_eq!(app.error_cursor, 2, "应停在最后一条错误（索引 2）");
    }

    // =========================================================================
    // 工作目录解析（resolve_work_dir / is_dev_layout）
    // 优先级：PRECIS_WORK_DIR > 开发态 qa_test（探测命中才用） > 用户主目录 > cwd
    // =========================================================================

    /// 在系统临时目录下构造独立的测试目录树，返回根路径
    fn make_test_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("precis-tui-workdir-{}-{}", std::process::id(), name));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).expect("create test root");
        root
    }

    /// 开发态布局 + qa_test 存在 → 沿用 <cwd.parent>/qa_test（历史行为保留）
    #[test]
    fn dev_layout_with_qa_test_uses_qa_test() {
        let root = make_test_root("dev");
        std::fs::create_dir_all(root.join("backend")).expect("backend dir");
        std::fs::create_dir_all(root.join("tui-rust/target/debug")).expect("exe dir");
        std::fs::create_dir_all(root.join("qa_test")).expect("qa_test dir");

        let got = resolve_work_dir(
            &root.join("tui-rust"),
            Some(&root.join("tui-rust/target/debug")),
            None,
            Some(&root.join("home")),
        );
        assert_eq!(got, root.join("qa_test"), "开发态应解析到 qa_test");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// 开发态布局但 qa_test 不存在 → 不使用 qa_test，回退主目录
    #[test]
    fn dev_layout_without_qa_test_falls_back_to_home() {
        let root = make_test_root("dev-noqa");
        std::fs::create_dir_all(root.join("backend")).expect("backend dir");
        std::fs::create_dir_all(root.join("tui-rust/target/debug")).expect("exe dir");

        let got = resolve_work_dir(
            &root.join("tui-rust"),
            Some(&root.join("tui-rust/target/debug")),
            None,
            Some(&root.join("home")),
        );
        assert_eq!(got, root.join("home"), "qa_test 缺失时应回退主目录");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// 打包态（exe 祖先链无 backend/，双击启动 cwd=安装目录）→ 回退用户主目录
    #[test]
    fn packaged_layout_falls_back_to_home() {
        let root = make_test_root("packaged");
        let exe_dir = root.join("installed/app");
        std::fs::create_dir_all(&exe_dir).expect("exe dir");
        // 安装目录旁就算有 qa_test 也不该被使用（无开发态布局探测命中）
        std::fs::create_dir_all(root.join("installed/qa_test")).expect("qa_test dir");

        let got = resolve_work_dir(
            &exe_dir,
            Some(&exe_dir),
            None,
            Some(&root.join("home")),
        );
        assert_eq!(got, root.join("home"), "打包态应回退用户主目录");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// PRECIS_WORK_DIR 环境变量最高优先（任何布局下都覆盖默认解析）
    #[test]
    fn precis_work_dir_env_overrides_everything() {
        let root = make_test_root("env");
        std::fs::create_dir_all(root.join("backend")).expect("backend dir");
        std::fs::create_dir_all(root.join("tui-rust/target/debug")).expect("exe dir");
        std::fs::create_dir_all(root.join("qa_test")).expect("qa_test dir");

        let got = resolve_work_dir(
            &root.join("tui-rust"),
            Some(&root.join("tui-rust/target/debug")),
            Some("D:/custom/work"),
            Some(&root.join("home")),
        );
        assert_eq!(got, PathBuf::from("D:/custom/work"), "环境变量应最高优先");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// 空串环境变量视同未设置（不产生空路径）
    #[test]
    fn empty_env_value_ignored() {
        let root = make_test_root("env-empty");
        std::fs::create_dir_all(root.join("backend")).expect("backend dir");
        std::fs::create_dir_all(root.join("tui-rust/target/debug")).expect("exe dir");
        std::fs::create_dir_all(root.join("qa_test")).expect("qa_test dir");

        let got = resolve_work_dir(
            &root.join("tui-rust"),
            Some(&root.join("tui-rust/target/debug")),
            Some(""),
            None,
        );
        assert_eq!(got, root.join("qa_test"), "空串应视同未设置，走开发态解析");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// 主目录不可得时的最后兜底：当前目录（不 panic、不空路径）
    #[test]
    fn no_home_falls_back_to_cwd() {
        let root = make_test_root("no-home");
        let exe_dir = root.join("installed");
        std::fs::create_dir_all(&exe_dir).expect("exe dir");

        let got = resolve_work_dir(&exe_dir, Some(&exe_dir), None, None);
        assert_eq!(got, exe_dir, "无主目录时应兜底到 cwd");
        let _ = std::fs::remove_dir_all(&root);
    }
}
