# Precis Electron 桌面端

本目录包含 Precis 的 Electron 桌面应用主进程代码。

## 打包策略

当前采用**方案 B**：Electron 安装包内包含后端源码，运行时依赖用户自行安装的 Python 环境。

### 方案 B（当前实现）

- `electron-builder` 通过 `build.extraResources` 将 `../backend` 复制到打包后的 `resources/backend`。
- `electron-builder` 通过 `build.extraResources` 将 `../frontend/dist` 复制到 `resources/frontend/dist`。
- 生产环境下，`electron/src/main.ts` 使用 `process.resourcesPath` 定位上述资源目录。
- 用户首次运行前，需在目标机器安装 Python `>=3.10,<3.14`，并在 `resources/backend` 目录执行：

```bash
pip install -e ".[api]"
```

> 注：安装包内不包含 Python 解释器和第三方依赖。后续可升级为方案 A（预安装 Python 并打包解释器 + 依赖）。

### 方案 A（推荐，待实现）

- 在构建机上准备目标平台 Python 解释器（如 `python-build-standalone` 或系统 Python）。
- 将解释器与 `site-packages` 一并打包到 `resources/backend/runtime`。
- `main.ts` 中 `pythonExecutable` 指向打包后的解释器，无需用户安装 Python。

## 开发运行

```bash
# 在项目根目录安装全部依赖
npm run install:all

# 同时启动后端 + 前端（开发模式）
npm run dev

# 单独启动 Electron（开发模式连接 Vite dev server）
cd electron && npm run dev
```

## 生产构建

```bash
# 构建前端和后端
cd frontend && npm run build
cd ../backend && pip install -e ".[api]"

# 构建 Electron 并打包
cd ../electron
npm run build:electron
npm run dist
```

构建产物位于 `electron/release/`。

## 排除的冗余目录

`extraResources.filter` 已排除以下目录，避免安装包体积膨胀：

- `__pycache__` 与各级 `__pycache__`
- `.mypy_cache`、`.pytest_cache`、`.ruff_cache`
- `.coverage`
- `*.egg-info`
- `build`、`dist`
- `tests`
- `.git`、`.gitignore`
