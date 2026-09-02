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

构建产物位于 `electron/release/`。产物名固定为 `Precis-Setup-<version>.exe`（`build.artifactName` 显式配置，无空格，`latest.yml`/blockmap 自动跟随，防止清单与产物命名漂移）。

## 版本发布与自动更新

### 发布（一条命令）

```bash
# 仓库根目录
npm run release -- 0.1.1 --dry-run    # 预览六处 manifest + CHANGELOG 切版
npm run release -- 0.1.1              # 正式发布：同步版本 → CHANGELOG 切版 → commit → tag → push
npm run release -- minor --prerelease alpha.1   # 0.1.0 → 0.2.0-alpha.1
```

版本单一事实源是根 `package.json` 的 `version`，发布脚本会同步到 electron/frontend/backend(pyproject)/tui-rust(Cargo) 六处（含 lockfile）。tag 推送后 CD（`.github/workflows/cd.yml`）自动执行：

1. `verify-manifests`：tag 版本与六处 manifest 全等校验，漂移即 fail
2. 三平台构建（Electron win/mac + CLI + TUI）
3. Release job：**自动 publish**（非 draft——draft 对 electron-updater 不可见，客户端将检测不到更新）；release notes 取自 CHANGELOG 对应版本分节；含 `-` 后缀的版本自动标记 prerelease
4. **产物自检闸门**：下载 Release 的 `latest.yml`，逐文件核对资产存在性 + size + sha512 实测一致（历史出过清单引用与实际产物命名漂移导致客户端更新 404）

发布回滚：`git tag -d vX.Y.Z && git push origin :refs/tags/vX.Y.Z`，并在 GitHub 删除对应 Release。

### 客户端自动更新

- 更新通道：GitHub Releases（`electron-updater`，`build.publish` 已配置）；设置面板支持切换自定义 generic 源——仅接受 https（http 仅限 `127.0.0.1`/`localhost` 本机更新演练），非法源保存即被拒绝、不会应用
- 打包应用启动 3 秒后自动检查（可在设置关闭）；下载完成后由用户确认重启安装
- 安装前主进程先同步终止 Python 子进程树（`resources/` 下的 backend/python-runtime 会被 NSIS 整目录覆盖，文件占用会导致安装失败）
- macOS 因未签名**不支持**自动更新（Squirrel.Mac 要求代码签名），仅提供安装包手动更新；Windows 未签名可正常自动更新（sha512 清单校验保证完整性）

### 本地"模拟生产"更新演练

```bash
cd electron
npm run update:drill -- lite     # 分钟级：复用 electron/release/ 真实产物，仅抬升清单版本号，验证检测/下载/安装全流程
npm run update:drill -- full     # 全真：构建两个真实版本（extraMetadata 覆盖，不污染工作区），验证真实升级闭环
npm run serve:updates            # 启动本地更新源 http://localhost:8080
```

演练步骤：生成本地源 → `serve:updates` → 应用设置中把更新源切到 `http://localhost:8080` → 检查更新 → 下载 → 重启安装 → 验证后把源切回 github。lite 模式安装的是同一二进制（版本号不变），只验证流程；full 模式验证版本真实变更（含后端 `PRECIS_APP_VERSION` 跟随）。

## 排除的冗余目录

`extraResources.filter` 已排除以下目录，避免安装包体积膨胀：

- `__pycache__` 与各级 `__pycache__`
- `.mypy_cache`、`.pytest_cache`、`.ruff_cache`
- `.coverage`
- `*.egg-info`
- `build`、`dist`
- `tests`
- `.git`、`.gitignore`
