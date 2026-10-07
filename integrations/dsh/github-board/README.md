# @local/github-board — GitHub 看板的 DSH 插件

在 DSH 侧边栏增加一个"GitHub 看板"面板，**只读**查阅当前项目远端的基本状态信息；
v0.2 起支持**授权登录**（设备流 / PAT / 复用 gh CLI）、**多仓库切换**与**富信息**。

## 展示内容

| 区块 | 数据 |
|---|---|
| 头部 | 仓库（链接）、**仓库切换器**（当前项目 + 我的仓库）、登录用户（头像/昵称）、刷新按钮、描述、语言/许可/主题/可见性/默认分支 |
| 本地状态 | 与上游领先/落后、已暂存/已修改/未跟踪计数（仅当前项目仓库） |
| GitHub 概览 | Stars / Forks / 开放 Issues / 开放 PR 四张卡片 |
| CI 与发布 | 默认分支检查聚合（通过/失败/运行中）+ 最新 Release 徽章 |
| PR / Issue | 各自 Top 5 列表（编号、标题链接、作者、标签、更新时间） |
| 最近提交 | 当前项目=本地 git log；其它仓库=API 提交（短 SHA 链接） |
| 页脚 | 数据时间（绝对 + 相对）、30 分钟自动轮询、**API 配额余量**、授权方式、git fetch 警告 |

刷新策略：**30 分钟自动轮询 + 面板挂载即拉取一次 + "刷新"按钮随时手动刷新**（手动刷新会先 `git fetch origin` 再重取快照）。

## 授权链（优先级从高到低；token 只存在 Host 侧，永不下发页面）

| 方式 | 说明 | 配置 |
|---|---|---|
| 面板登录 | ① GitHub 设备流：面板显示 user_code → 浏览器打开 github.com/login/device 输入 → 自动完成；② PAT 粘贴（建议细粒度只读） | 设备流需 `oauthClientId`（见下）；PAT 零配置 |
| 配置令牌 | 静态 token | `githubToken`（或环境变量 `GITHUB_TOKEN`） |
| gh CLI | 自动复用本机 `gh auth token`（5 分钟缓存），与 gh CLI 共享登录态 | 无需配置，装好并登录 gh 即可 |
| 匿名 | 公开仓库只读，60 req/h | 缺省 |

登录凭据落盘于插件目录 `.auth.json`（已被本目录 `.gitignore` 忽略；PoC 级存储，生产版应迁移 DSH credentials 服务）。

## 组成

| 文件 | 职责 |
|---|---|
| `host.js` | Host 半：授权链解析与 auth 端点族（`/auth/start` 设备流、`/auth/status`、`/auth/token`、`/auth/logout`、`/auth/cancel`）；git 采集；GitHub REST（`/user`、`/user/repos`、仓库概览 + PR/Issue/Release/check-runs/commits，TTL 缓存 + 速率余量记录）；`/status?repo=`、`/refresh` 微壳端点（CORS、并发去重） |
| `client.js` | Client 半（React）：看板面板 + 登录弹层（设备流/PAT 双 Tab、设备码一键复制）+ 仓库切换器；全 `--dsw-alias-*` token 主题（v0.2.1 视觉打磨：着色状态胶囊、悬浮微抬统计卡、行悬浮高亮、环形加载动画）；zh/en 双语；所有 interval 卸载即清理 |
| `cordis.patch.yml` | 插入行 + 配置（`repoDir` / `port` / `githubToken` / `oauthClientId` / `oauthScope`） |

## 使用

1. `plugin_manager install_bundle <本目录绝对路径>`。
2. **重启 DSH**（Host 半模块代缓存，代码更新后必须重启生效），刷新页面 → 左侧边栏 GitHub 图标。
3. 本机装有 gh 并已 `gh auth login` → 看板自动进入已登录状态；否则点右上角"登录 GitHub"。
4. 设备流登录：需先在 GitHub 创建 OAuth App（Settings → Developer settings → OAuth Apps，
   Callback 随意，**启用 Device Flow**），把 client_id 填进 patch 配置 `oauthClientId` 并重装 + 重启。
5. "刷新"按钮执行 `git fetch origin` 后重取快照。

## 已知限制（PoC）

- `port` 同时硬编码在 client.js 的 `BASE`（默认 17861）；改配置需两处同步。
- **替换已安装包的 host.js 需重启 DSH**（模块代缓存）；client.js 改动刷新页面即生效。
- 设备流依赖 OAuth App 启用 Device Flow；未配置 `oauthClientId` 时面板提示改用 PAT / gh。
- 开放 PR/Issue 列表各取 Top 5（`5+` 表示更多）；仓库列表取最近推送的前 100 个。
- `.auth.json` 为明文 PoC 存储；退出登录仅删除本地凭据（GitHub 侧授权可在 Settings → Applications 撤销）。
