# AGENTS.md — tui-rust

TUI（终端 UI）模块的开发指南。根项目的架构原则见 [`../AGENTS.md`](../AGENTS.md)。

> **模块定位**：TUI 是 Python 后端的**纯客户端**，通过 HTTP（reqwest）调用后端 API。业务逻辑（校验、配置解析、AI）全部在后端，TUI 不重复实现。

---

## Tech Stack

| 层级 | 技术 |
|------|------|
| TUI 框架 | ratatui 0.29 |
| 终端后端 | crossterm 0.28 |
| 异步运行时 | tokio（full features） |
| HTTP 客户端 | reqwest 0.12 |
| 序列化 | serde / serde_json |
| 错误处理 | anyhow |
| 日志 | tracing + tracing-subscriber |

---

## 关键约定

### 1. 渲染循环不阻塞（核心架构）

主事件循环（`main.rs` 的 `run_app`）**必须保持同步且非阻塞**。所有可能耗时的操作（HTTP 请求、文件 IO）按以下模式处理：

```
按键事件 → tokio::spawn 后台 task → HTTP 请求 → mpsc channel 回传 → 主循环 handle_bg_message 处理
```

- 用 `mpsc::channel(32)` 在主循环与后台 task 间通信
- **禁止**在事件循环内直接 `.await` HTTP 请求
- 状态机：`Loading` → 收到 channel 消息 → `Loaded`/`Error`

### 2. 图标规则（icons.rs）

- **禁用 emoji**（双宽、跨终端渲染不一致）
- **禁用 `⚙`** 等双宽符号（破坏对齐）
- 只用**单宽几何符号**（`◈ ◇ ◆ ◉ ◎ ● ○ ◐` 等）
- 同一语义只用同一字符（如选中标记统一 `▸`）
- 所有图标集中在 `icons.rs` 定义，UI 代码不内联符号字面量

### 3. 配色系统（app.rs colors）

- 双主题（Sakura 樱花粉 / Snow 飘雪冰蓝），通过 `thread_local` 持有当前调色板
- 颜色取自 `app::colors` 的访问函数（`colors::bg()` / `colors::pink()` 等），UI 代码**不硬编码 `Color::Rgb(...)`**
- 新增颜色统一加到 `Palette` 结构体，两个主题都要提供值
- 主题切换后 `theme.rs` 自动持久化到 `~/.precis/tui-theme.json`

### 4. UI 结构（顶部标签栏布局）

- 骨架在 `ui/mod.rs`：品牌行（1 行）+ tab 栏（2 行，含滑动指示条）+ 全宽内容区 + 状态栏（2 行）
- **共享组件统一放 `ui/widgets.rs`**（panel / section_header / keychip / meter / stat_card / badge / gradient_spans / wrap_text），页面代码不重复造轮子
- 切 tab 动效由 `App::switch_tab()` 自动记录（指示条滑动 + 内容淡入），**禁止直接赋值 `app.current_tab`**
- `fx.rs` 动效 = 主题飘落粒子（樱花瓣/雪花，摇摆下落）+ 弱化移动光场；粒子字形只写空白 cell，不遮挡内容；粒子字形集在 `fx.rs` 顶部常量（含保守回退集）
- 双宽字符注意：ratatui 0.29 buffer 不给宽字符续格打标记，测试提取 buffer 文本时须按符号显示宽度步进（参考 `ui/mod.rs` 测试的 `render_to_string`）

### 5. 后端交互（api/）

- `ApiClient::new(base_url)` 创建客户端，`base_url` 来自 `PRECIS_BACKEND_URL` 环境变量（默认 `http://127.0.0.1:18000`）
- 后端响应类型定义在 `api/types.rs`，字段与后端 Pydantic 模型对应
- 后端端点路径与 `backend/app/api/routers/` 保持一致

---

## 常用命令

```bash
# 构建（开发）
cd tui-rust && cargo build

# 运行（需后端先启动）
cd tui-rust && cargo run

# Release 构建（LTO 优化）
cd tui-rust && cargo build --release

# 类型检查 / 编译检查（不运行）
cd tui-rust && cargo check

# 格式化
cd tui-rust && cargo fmt

# Lint
cd tui-rust && cargo clippy
```

---

## 编码规范

- **edition 2021**，`#![allow(dead_code)]` 抑制预留字段/图标的 warning（API 响应含后端返回但 TUI 暂未展示的字段）
- 命名：模块 snake_case，类型 PascalCase，常量 UPPER_SNAKE_CASE
- 错误传播用 `anyhow::Result` + `?`，顶层 `main` 返回 `Result<()>`
- 中文注释（与根项目一致）
- Release profile 已启用 `opt-level = 3` + `lto = true`
