# 安装

Precis 提供三种入口：**桌面应用**（推荐）、**CLI**、**REST API**。按使用场景选择即可，三者共享同一套 V2 YAML 项目配置。

> [!WARNING]
> Precis 处于 Alpha 阶段，安装包尚未购买代码签名证书，首次运行出现系统安全警告属正常现象，处理方式见下文。

## 桌面应用（推荐）

无需任何前置环境，从 [GitHub Releases](https://github.com/AirSaiga/Precis/releases) 下载对应平台的安装包：

| 平台 | 下载文件 |
| ---- | -------- |
| Windows x64 | `Precis-Setup-x.y.z.exe`（NSIS 安装程序） |
| macOS Apple Silicon | `Precis-x.y.z-arm64.dmg` |
| macOS Intel | `Precis-x.y.z.dmg`（x64） |

下载后双击安装。桌面应用内置 Python 运行时，安装后即可使用，无需配置环境。

### 首次运行的安全警告处理

Alpha 版本未经代码签名，首次运行时操作系统会弹出安全警告：

**Windows（SmartScreen）**

1. 双击安装程序，看到「Windows 已保护你的电脑」窗口
2. 点击**更多信息** → **仍要运行**，按提示完成安装

**macOS（Gatekeeper）**

- 打开 DMG 时提示「无法验证开发者」或「已损坏」：在终端执行（替换为实际路径）：

  ```bash
  sudo xattr -d -r com.apple.quarantine /Applications/Precis.app
  ```

- 首次启动提示「无法打开」：右键点击 Precis.app → **打开** → 在弹窗中再点**打开**，仅需一次

正式签名版本发布后，以上步骤将不再需要。

## CLI 命令行

适合 CI/CD 流水线、批量校验与 Agent 工具链集成。

```bash
pip install precis-cli
```

要求 Python `>=3.12, <3.14`。安装后获得 `precis` 命令，可进入交互式 Shell，或直接独立执行校验：

```bash
precis validate --manifest /path/to/project.precis.yaml
```

完整命令说明见 [CLI 参考](/reference/cli)。

## REST API

适合自定义集成开发。从源码启动后端服务，获得带 Swagger UI 的 REST API：

```bash
git clone https://github.com/AirSaiga/Precis.git
cd Precis

# 一键脚本：安装依赖并构建（Windows）
npm run setup:win
# macOS / Linux
# npm run setup:mac

# 启动 API 服务
cd backend && source .venv/bin/activate   # Windows: .venv\Scripts\activate
python -m uvicorn app.api.main:app --host 127.0.0.1 --port 18000
```

浏览器打开 `http://127.0.0.1:18000/docs` 查看自动生成的 Swagger UI。

### 从源码运行的版本要求

| 工具 | 版本 | 说明 |
| ---- | ---- | ---- |
| Node.js | `^20.19.0 \|\| >=22.12.0` | 含 npm |
| Python | `>=3.12, <3.14` | 3.12 或 3.13 |
| Git | 任意版本 | 克隆仓库 |

## TUI 终端界面（实验性）

Rust 编写的终端界面，不随 Release 发布，需要 Rust stable 工具链，从源码构建：详见仓库 [`tui-rust/README.md`](https://github.com/AirSaiga/Precis/blob/main/tui-rust/README.md)。

## 验证安装

```bash
# 源码方式可一键自检：用内置示例数据跑一次校验
npm run cli:validate
```

输出校验结果即代表环境就绪。
