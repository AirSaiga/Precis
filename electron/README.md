# Precis Electron 桌面端

本目录包含 Precis 的 Electron 桌面应用主进程代码。

## 打包策略

当前采用**方案 A**：Electron 安装包内包含后端源码以及内嵌的 Python 运行时与依赖，用户无需自行安装 Python。

### 方案 A（当前实现）

- 构建时通过 `electron/scripts/fetch-python.js` 下载目标平台的 `python-build-standalone` 到 `electron/resources/python-runtime/`。
- 通过 `electron/scripts/install-backend-deps.js` 使用内嵌解释器安装 `../backend/requirements.txt` 到其 site-packages。
- `electron-builder` 通过 `build.extraResources` 将运行时、后端源码、`../frontend/dist` 复制到打包后的 `resources/`。
- 生产环境下，`electron/src/main.ts` 的 `resolvePythonExecutable()` 优先使用 `resources/python-runtime/` 中的解释器。
- 开发模式仍回退到系统 Python，便于调试。

### 方案 B（已弃用）

- Electron 安装包内仅包含后端源码，运行时依赖用户自行安装的 Python 环境。
- 用户需在目标机器安装 Python `>=3.12,<3.14` 并执行 `pip install -e ".[api]"`。
- 该方案在桌面端交付中体验较差，已不再使用。

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
