//! 后端子进程编排（打包态自包含模式）
//!
//! 仅在 `PRECIS_BACKEND_URL` 未设置时启用：定位 bundled/系统 Python，
//! spawn `start_server.py --port 0`，轮询 `.backend-port` 拿到实际端口，
//! TUI 退出时通过 `Drop` 清理子进程。
//!
//! 行为对齐 Electron 的 `pythonProcess.ts` 与 `startup-probe.ts`。

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use anyhow::{Context, Result, bail};

/// 端口文件轮询间隔
const PORT_POLL_INTERVAL: Duration = Duration::from_millis(200);
/// 端口文件出现超时
const PORT_POLL_TIMEOUT: Duration = Duration::from_secs(30);
/// 启动后额外等待健康检查的最长时间
const HEALTH_CHECK_TIMEOUT: Duration = Duration::from_secs(15);
/// 健康检查轮询间隔
const HEALTH_POLL_INTERVAL: Duration = Duration::from_millis(500);

/// 后端子进程句柄，Drop 时自动关闭
pub struct BackendHandle {
    child: Option<Child>,
    port: u16,
    /// 是否由本进程拉起（外部后端模式为 false，无需清理）
    owned: bool,
}

impl BackendHandle {
    /// 返回后端监听端口
    pub fn port(&self) -> u16 {
        self.port
    }

    /// 主动关闭（通常不需要调用，Drop 会处理）
    pub fn shutdown(&mut self) {
        if !self.owned {
            return;
        }
        if let Some(child) = self.child.as_mut() {
            kill_process_tree(child);
        }
        self.child = None;
    }

    /// 启动后端子进程并返回端口。
    ///
    /// 解析优先级（对齐 Electron `resolvePythonExecutable`）：
    /// 1. `PYTHON_PATH` 环境变量 → 用它当解释器
    /// 2. exe 同级 `python-runtime/` → bundled runtime（打包态）
    /// 3. exe 上两级 `python-runtime/` → `cargo run` 开发态布局兜底
    /// 4. 系统 `python3` / `python` → dev 回退
    pub fn start() -> Result<Self> {
        // 定位 backend 源码目录与 start_server.py
        let backend_dir = resolve_backend_dir()?;
        let server_script = backend_dir.join("app").join("start_server.py");
        if !server_script.exists() {
            bail!("后端启动脚本不存在: {}", server_script.display());
        }

        // 定位 Python 解释器
        let python_exe = resolve_python_executable(&backend_dir)?;

        // 端口文件路径：后端写到这里
        let port_file = backend_dir.join(".backend-port");
        // 启动前先清理残留（旧端口文件会误导发现逻辑）
        let _ = std::fs::remove_file(&port_file);

        println!("[backend] 启动后端: {} app/start_server.py --port 0", python_exe.display());
        println!("[backend] cwd: {}", backend_dir.display());

        let mut cmd = Command::new(&python_exe);
        cmd.arg(&server_script)
            .arg("--port")
            .arg("0")
            .current_dir(&backend_dir)
            // 丢弃 IO，避免与 TUI 的 alternate screen 抢占
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .env("PYTHONUNBUFFERED", "1")
            .env("PYTHONIOENCODING", "utf-8")
            .env("PYTHONDONTWRITEBYTECODE", "1");

        // Unix: 新进程组，便于整组清理
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            cmd.process_group(0);
        }
        // Windows: 不弹新窗口
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            // CREATE_NO_WINDOW = 0x08000000
            cmd.creation_flags(0x08000000);
        }

        let child = cmd
            .spawn()
            .with_context(|| format!("无法启动后端进程: {}", python_exe.display()))?;

        // 轮询端口文件
        let port = wait_for_port_file(&port_file)
            .with_context(|| format!("后端启动超时，未生成端口文件: {}", port_file.display()))?;

        // 健康检查（最长再等 15s）
        wait_for_health(port).context("后端已启动但健康检查失败")?;

        println!("[backend] 后端就绪，端口 {}", port);
        Ok(BackendHandle {
            child: Some(child),
            port,
            owned: true,
        })
    }
}

impl Drop for BackendHandle {
    fn drop(&mut self) {
        self.shutdown();
    }
}

/// 解析 backend 源码目录。
///
/// 打包态布局：
/// ```text
/// precis-tui/                <- exe 所在目录
/// ├── precisis-tui(.exe)
/// ├── python-runtime/
/// └── backend/               <- 目标
/// ```
/// `cargo run` 开发态布局：
/// ```text
/// tui-rust/                  <- exe 在 target/(debug|release)/
/// └── ../backend/            <- 上溯到仓库根再进 backend
/// ```
fn resolve_backend_dir() -> Result<PathBuf> {
    // exe 所在目录（打包态）
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            let candidate = exe_dir.join("backend");
            if candidate.join("app").join("start_server.py").exists() {
                return Ok(candidate);
            }
        }
    }
    // 仓库根的 backend（开发态：从 tui-rust/ 上溯）
    if let Ok(cwd) = std::env::current_dir() {
        // cwd 可能是 tui-rust/，也可能是 target/...
        for ancestor in cwd.ancestors() {
            let candidate = ancestor.join("backend");
            if candidate.join("app").join("start_server.py").exists() {
                return Ok(candidate);
            }
        }
    }
    bail!("无法定位 backend 源码目录（未找到 app/start_server.py）")
}

/// 解析 Python 解释器路径。优先级见 [`BackendHandle::start`] 文档。
fn resolve_python_executable(backend_dir: &Path) -> Result<PathBuf> {
    // 1. 环境变量显式指定
    if let Ok(p) = std::env::var("PYTHON_PATH") {
        if !p.is_empty() {
            let path = PathBuf::from(p);
            if path.exists() {
                return Ok(path);
            }
        }
    }

    // 定位可能的 runtime 父目录：打包态在 exe 同级，开发态在仓库根
    let runtime_candidates = runtime_search_dirs();

    for base in runtime_candidates {
        let win_python = base.join("python-runtime").join("python").join("python.exe");
        if win_python.exists() {
            return Ok(win_python);
        }
        let unix_python = base.join("python-runtime").join("bin").join("python3");
        if unix_python.exists() {
            return Ok(unix_python);
        }
    }

    // 4. 系统 Python 兜底（开发态）
    if let Ok(p) = which_system_python() {
        return Ok(p);
    }

    let _ = backend_dir; // 保留参数以便未来扩展（如 backend 同级 runtime）
    bail!(
        "未找到 Python 解释器。请设置 PYTHON_PATH 环境变量，或在 exe 同级放置 python-runtime/ 目录"
    )
}

/// 收集 runtime 可能所在的父目录列表（打包态 exe 同级 + 开发态仓库根）
fn runtime_search_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            dirs.push(exe_dir.to_path_buf());
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        for ancestor in cwd.ancestors().take(5) {
            dirs.push(ancestor.to_path_buf());
        }
    }
    dirs
}

/// 在 PATH 中查找系统 python3 / python
fn which_system_python() -> Result<PathBuf> {
    let candidates = if cfg!(windows) {
        ["python.exe", "python3.exe"]
    } else {
        ["python3", "python"]
    };
    for name in candidates {
        if let Some(path) = find_in_path(name) {
            return Ok(path);
        }
    }
    bail!("PATH 中未找到 python")
}

/// 简易 PATH 查找（避免引入 which/wait-time 依赖）
fn find_in_path(name: &str) -> Option<PathBuf> {
    let path_env = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_env) {
        let full = dir.join(name);
        if full.is_file() {
            return Some(full);
        }
    }
    None
}

/// 轮询端口文件直到出现，返回其中的端口号
fn wait_for_port_file(port_file: &Path) -> Result<u16> {
    let start = Instant::now();
    loop {
        if let Ok(content) = std::fs::read_to_string(port_file) {
            let trimmed = content.trim();
            if let Ok(port) = trimmed.parse::<u16>() {
                if port > 0 {
                    return Ok(port);
                }
            }
        }
        if start.elapsed() > PORT_POLL_TIMEOUT {
            bail!("等待端口文件超时");
        }
        std::thread::sleep(PORT_POLL_INTERVAL);
    }
}

/// 健康检查：GET /health 直到 200 或超时
fn wait_for_health(port: u16) -> Result<()> {
    let start = Instant::now();
    loop {
        if try_health(port) {
            return Ok(());
        }
        if start.elapsed() > HEALTH_CHECK_TIMEOUT {
            bail!("健康检查超时");
        }
        std::thread::sleep(HEALTH_POLL_INTERVAL);
    }
}

/// 单次健康检查（阻塞式，超时 2s）
fn try_health(port: u16) -> bool {
    // 用 std::net 直连，避免依赖 reqwest 的同步接口
    use std::io::{Read, Write};
    use std::net::TcpStream;

    let addr: std::net::SocketAddr = match format!("127.0.0.1:{}", port).parse() {
        Ok(a) => a,
        Err(_) => return false,
    };
    let mut stream = match TcpStream::connect_timeout(&addr, Duration::from_secs(2)) {
        Ok(s) => s,
        Err(_) => return false,
    };
    if stream.set_read_timeout(Some(Duration::from_secs(2))).is_err() {
        return false;
    }
    if stream
        .write_all(b"GET /health HTTP/1.0\r\nHost: localhost\r\n\r\n")
        .is_err()
    {
        return false;
    }
    let mut buf = [0u8; 64];
    let n = match stream.read(&mut buf) {
        Ok(n) => n,
        Err(_) => return false,
    };
    let response = String::from_utf8_lossy(&buf[..n]);
    // HTTP/1.0 200 OK
    response.starts_with("HTTP/") && response.contains(" 200 ")
}

/// 杀掉进程树（对齐 Electron 的 taskkill /T /F 与 Unix 进程组 kill）
fn kill_process_tree(child: &mut Child) {
    // 先尝试用 PID 直接 kill 整组
    #[cfg(unix)]
    {
        // child.id() 是 u32，libc kill 需要 i32；显式标注避免类型推断歧义
        if let Ok(pid) = i32::try_from(child.id()) {
            // 向进程组发送 SIGTERM（负数 PID 表示进程组）
            unsafe {
                libc_kill(-pid, 15); // SIGTERM
            }
            // 给一点时间优雅退出
            std::thread::sleep(Duration::from_millis(200));
            unsafe {
                libc_kill(-pid, 9); // SIGKILL
            }
        }
    }
    #[cfg(windows)]
    {
        if let Some(pid) = child.id().to_string().parse::<u32>().ok() {
            // taskkill /T /F /PID <pid>  —— /T 杀整个子进程树
            let _ = Command::new("taskkill")
                .args(["/T", "/F", "/PID", &pid.to_string()])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        }
    }
    // 兜底：reclaim 子进程
    let _ = child.kill();
    let _ = child.wait();
}

// Unix libc kill 绑定（避免引入 libc crate）
#[cfg(unix)]
extern "C" {
    #[link_name = "kill"]
    fn libc_kill(pid: i32, sig: i32) -> i32;
}
