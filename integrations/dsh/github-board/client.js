/*
 * SPDX-License-Identifier: Apache-2.0
 *
 * Copyright 2026 Precis Team
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/**
 * DSH Client 半（React，经 window.__ModuleLoader__ 注入）：
 *   sidebar.panellist[id=github-board] → main[key=github-board] GitHub 看板面板（v0.2.1）
 *
 * 数据来自 Host 半的微壳（127.0.0.1:17861）：
 *   GET  /status?repo=owner/name   快照：登录身份、我的仓库、所选仓库概览/PR/Issue/Release/CI/提交
 *   POST /refresh?repo=…           先 `git fetch origin` 再返回最新快照（手动刷新按钮）
 *   POST /auth/start               GitHub 设备流登录（user_code + 验证页）
 *   GET  /auth/status              登录会话状态（pending/authorized/error）
 *   POST /auth/token               PAT 粘贴登录
 *   POST /auth/logout | /auth/cancel
 * 刷新策略：30 分钟自动轮询 + 随时手动刷新；面板挂载即拉取一次。
 * 主题全部使用 --dsw-alias-* token（亮/暗自适应）；文本经 locale 服务（zh/en 双语）。
 * 资源纪律：所有 interval 在组件卸载/状态切换时无条件清理。
 */
window.__ModuleLoader__.load({
  id: '@local/github-board',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'githubBoard'
    const PANEL_ID = 'github-board'
    // 与 Host 半 cordis.patch.yml 的 port 保持一致（PoC 约定；发布版应经配置下发）
    const BASE = 'http://127.0.0.1:17861'
    // 自动轮询 30 分钟（用户要求放缓）；手动"刷新"按钮随时可用
    const POLL_MS = 30 * 60_000
    const AUTH_POLL_MS = 5_000

    const dict = {
      zh: {
        'panel.title': 'GitHub 看板',
        'panel.loading': '加载中…',
        'panel.error': '无法连接 GitHub 看板服务',
        'panel.hint': '请确认 github-board 插件已启用（Host 半监听 127.0.0.1:17861，Host 代码更新后需重启 DSH）。',
        'panel.notRepo': '该目录不是 git 仓库',
        'repo.noRemote': '未配置 GitHub origin 远端',
        'repo.current': '⌂ 当前项目',
        'repo.mine': '我的仓库',
        'repo.picker': '选择仓库',
        'repo.none': '登录后可浏览你的仓库列表',
        'sync.synced': '与远端同步',
        'sync.ahead': '领先远端',
        'sync.behind': '落后远端',
        'sync.noUpstream': '当前分支无上游跟踪',
        'wt.title': '工作区',
        'wt.clean': '干净',
        'wt.staged': '已暂存',
        'wt.unstaged': '已修改',
        'wt.untracked': '未跟踪',
        'gh.stars': 'Stars',
        'gh.forks': 'Forks',
        'gh.issues': '开放 Issues',
        'gh.pulls': '开放 PR',
        'gh.unavailable': 'GitHub API 不可用',
        'gh.reason.not-found-or-private': '仓库不存在，或为私有且当前未授权（登录后可查看）',
        'gh.reason.rate-limited': '触发 API 速率限制，稍后自动恢复',
        'gh.reason.network-error': '网络错误',
        'gh.reason.no-remote': '无 GitHub 远端',
        'meta.language': '语言',
        'meta.license': '许可',
        'meta.default': '默认分支',
        'ci.title': 'CI',
        'ci.none': '无检查',
        'ci.success': '通过',
        'ci.failure': '失败',
        'ci.pending': '运行中',
        'ci.other': '未知',
        'release.none': '暂无 Release',
        'pulls.title': 'Pull Requests',
        'pulls.empty': '没有开放的 PR',
        'issues.title': 'Issues',
        'issues.empty': '没有开放的 Issue',
        'list.updated': '更新于',
        'list.draft': '草稿',
        'commits.title': '最近提交',
        'commits.empty': '无提交记录',
        'commits.local': '本地 git',
        'commits.remote': '远端',
        'auth.login': '登录 GitHub',
        'auth.logout': '退出登录',
        'auth.method.gh': 'gh CLI 授权',
        'auth.method.config': '配置令牌',
        'auth.method.login': '面板登录',
        'auth.method.anon': '匿名',
        'auth.tab.device': '设备授权',
        'auth.tab.pat': '访问令牌',
        'auth.intro': '登录后可查看你的全部仓库（含私有）、PR/Issue 列表、CI 状态等，并将 API 配额提升到 5000 次/小时。',
        'auth.ghActive': '已通过本机 gh CLI 授权（无需操作）；如需改用其他账号请使用下方方式登录。',
        'auth.device.start': '开始设备授权',
        'auth.device.retry': '重试',
        'auth.device.step1': '1. 点击打开 GitHub 授权页',
        'auth.device.step2': '2. 输入下方代码',
        'auth.device.open': '打开授权页',
        'auth.device.copy': '复制',
        'auth.device.copied': '已复制 ✓',
        'auth.device.waiting': '等待授权完成…（在浏览器完成输入后自动继续）',
        'auth.device.success': '授权成功',
        'auth.device.cancel': '取消',
        'auth.device.error.no-client-id': '设备授权需要在插件配置 oauthClientId（创建 GitHub OAuth App 并启用 Device Flow）。可先使用"访问令牌"方式登录。',
        'auth.device.error.expired-token': '代码已过期，请重新发起授权',
        'auth.device.error.access_denied': '已拒绝授权',
        'auth.device.error.unsupported_grant_type': '该 OAuth App 未启用 Device Flow（应用设置中打开）',
        'auth.device.error.start-failed': '发起授权失败',
        'auth.pat.input': 'GitHub 访问令牌（PAT）',
        'auth.pat.save': '保存并登录',
        'auth.pat.invalid': '令牌无效或已过期',
        'auth.pat.hint': '建议使用细粒度 PAT 并只授予只读仓库/用户权限；令牌仅保存在本机插件目录，不会回传到页面。',
        'auth.close': '关闭',
        'refresh': '刷新',
        'refreshing': '刷新中…',
        'refresh.failed': 'git fetch 失败（网络或认证问题），已展示本地数据',
        'updated': '数据时间',
        'auto': '30 分钟自动刷新',
        'rate': 'API 配额',
        'time.justNow': '刚刚',
        'time.minAgo': '{n} 分钟前',
        'time.hourAgo': '{n} 小时前',
        'time.dayAgo': '{n} 天前',
        'time.weekAgo': '{n} 周前',
        'time.monthAgo': '{n} 个月前',
        'time.yearAgo': '{n} 年前',
      },
      en: {
        'panel.title': 'GitHub Board',
        'panel.loading': 'Loading…',
        'panel.error': 'Cannot reach the GitHub board service',
        'panel.hint': 'Make sure the github-board plugin is enabled (host half listens on 127.0.0.1:17861; host code updates require a DSH restart).',
        'panel.notRepo': 'The configured directory is not a git repository',
        'repo.noRemote': 'No GitHub origin remote configured',
        'repo.current': '⌂ Current project',
        'repo.mine': 'My repositories',
        'repo.picker': 'Select repository',
        'repo.none': 'Sign in to browse your repositories',
        'sync.synced': 'In sync with remote',
        'sync.ahead': 'ahead of remote',
        'sync.behind': 'behind remote',
        'sync.noUpstream': 'Current branch has no upstream',
        'wt.title': 'Worktree',
        'wt.clean': 'clean',
        'wt.staged': 'staged',
        'wt.unstaged': 'modified',
        'wt.untracked': 'untracked',
        'gh.stars': 'Stars',
        'gh.forks': 'Forks',
        'gh.issues': 'Open issues',
        'gh.pulls': 'Open PRs',
        'gh.unavailable': 'GitHub API unavailable',
        'gh.reason.not-found-or-private': 'Repo not found, or private while not authorized (sign in to view)',
        'gh.reason.rate-limited': 'API rate limited; recovers automatically',
        'gh.reason.network-error': 'Network error',
        'gh.reason.no-remote': 'No GitHub remote',
        'meta.language': 'Language',
        'meta.license': 'License',
        'meta.default': 'Default branch',
        'ci.title': 'CI',
        'ci.none': 'no checks',
        'ci.success': 'passing',
        'ci.failure': 'failing',
        'ci.pending': 'running',
        'ci.other': 'unknown',
        'release.none': 'No releases',
        'pulls.title': 'Pull Requests',
        'pulls.empty': 'No open pull requests',
        'issues.title': 'Issues',
        'issues.empty': 'No open issues',
        'list.updated': 'updated',
        'list.draft': 'draft',
        'commits.title': 'Recent commits',
        'commits.empty': 'No commits',
        'commits.local': 'local git',
        'commits.remote': 'remote',
        'auth.login': 'Sign in to GitHub',
        'auth.logout': 'Sign out',
        'auth.method.gh': 'gh CLI',
        'auth.method.config': 'config token',
        'auth.method.login': 'panel login',
        'auth.method.anon': 'anonymous',
        'auth.tab.device': 'Device auth',
        'auth.tab.pat': 'Access token',
        'auth.intro': 'Sign in to browse all your repositories (including private), PR/issue lists, CI status, and raise the API quota to 5000 req/h.',
        'auth.ghActive': 'Already authorized via the local gh CLI (nothing to do); use the options below to sign in as another account.',
        'auth.device.start': 'Start device authorization',
        'auth.device.retry': 'Retry',
        'auth.device.step1': '1. Open the GitHub authorization page',
        'auth.device.step2': '2. Enter the code below',
        'auth.device.open': 'Open authorization page',
        'auth.device.copy': 'Copy',
        'auth.device.copied': 'Copied ✓',
        'auth.device.waiting': 'Waiting for authorization… (continues automatically once you confirm in the browser)',
        'auth.device.success': 'Authorized',
        'auth.device.cancel': 'Cancel',
        'auth.device.error.no-client-id': 'Device auth needs oauthClientId in the plugin config (create a GitHub OAuth App with Device Flow enabled). You can sign in with an access token instead.',
        'auth.device.error.expired-token': 'Code expired; start again',
        'auth.device.error.access_denied': 'Authorization denied',
        'auth.device.error.unsupported_grant_type': 'Device Flow is not enabled for this OAuth App (turn it on in app settings)',
        'auth.device.error.start-failed': 'Failed to start authorization',
        'auth.pat.input': 'GitHub access token (PAT)',
        'auth.pat.save': 'Save and sign in',
        'auth.pat.invalid': 'Token is invalid or expired',
        'auth.pat.hint': 'Prefer a fine-grained PAT with read-only repo/user permissions; the token stays on this machine in the plugin directory and is never sent back to the page.',
        'auth.close': 'Close',
        'refresh': 'Refresh',
        'refreshing': 'Refreshing…',
        'refresh.failed': 'git fetch failed (network or auth); showing local data',
        'updated': 'Data as of',
        'auto': 'auto refresh 30 min',
        'rate': 'API quota',
        'time.justNow': 'just now',
        'time.minAgo': '{n} min ago',
        'time.hourAgo': '{n} h ago',
        'time.dayAgo': '{n} d ago',
        'time.weekAgo': '{n} w ago',
        'time.monthAgo': '{n} mo ago',
        'time.yearAgo': '{n} y ago',
      },
    }

    /** locale.bind 在 apply 中赋值；组件渲染时经闭包读取 */
    let t = (key) => key

    const STYLE = `
.ghb-root{width:100%;height:100%;overflow:auto;padding:20px 24px;box-sizing:border-box;color:var(--dsw-alias-label-primary);font-size:13px}
.ghb-wrap{max-width:960px;margin:0 auto;display:flex;flex-direction:column;gap:16px}
.ghb-card{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:12px;padding:14px 16px;transition:border-color .15s ease}
.ghb-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.ghb-mark{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:9px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary);flex-shrink:0}
.ghb-title{display:inline-flex;align-items:baseline;gap:2px;font-size:16px;font-weight:650;text-decoration:none;color:var(--dsw-alias-label-primary)}
.ghb-owner{color:var(--dsw-alias-label-secondary);font-weight:500}
.ghb-reponame{transition:color .15s}
.ghb-title:hover .ghb-reponame{color:var(--dsw-alias-brand-primary)}
.ghb-desc{color:var(--dsw-alias-label-secondary);margin-top:7px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px}
.ghb-metarow{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:9px}
.ghb-tag{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);border-radius:6px;padding:1px 8px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.ghb-select{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-radius:8px;padding:4px 8px;font-size:12px;max-width:250px;cursor:pointer;transition:border-color .15s}
.ghb-select:hover{border-color:var(--dsw-alias-label-secondary)}
.ghb-user{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);border-radius:999px;padding:2px 11px 2px 3px;color:var(--dsw-alias-label-primary);text-decoration:none;font-size:12px;transition:border-color .15s}
.ghb-user:hover{border-color:var(--dsw-alias-brand-primary)}
.ghb-user img{border-radius:50%;display:block}
.ghb-spacer{flex:1}
.ghb-btn{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-radius:8px;padding:5px 13px;cursor:pointer;font-size:12.5px;transition:border-color .15s,transform .05s;text-decoration:none}
.ghb-btn:hover{border-color:var(--dsw-alias-label-secondary)}
.ghb-btn:active{transform:scale(.97)}
.ghb-btn[disabled]{opacity:.55;cursor:default;transform:none}
.ghb-btn-primary{border-color:transparent;background:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-bg-base);font-weight:600}
.ghb-btn-primary:hover{border-color:transparent;filter:brightness(1.08)}
button.ghb-btn:focus-visible,a:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.ghb-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.ghb-ok{color:var(--dsw-alias-state-success-primary)}
.ghb-warn{color:var(--dsw-alias-state-warn-primary)}
.ghb-bad{color:var(--dsw-alias-state-error-primary)}
.ghb-muted{color:var(--dsw-alias-label-secondary)}
.ghb-pill{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:3px 11px;font-size:12px;font-weight:500;border:1px solid transparent;white-space:nowrap}
.ghb-pill a{color:inherit;text-decoration:none}
.ghb-pill a:hover{text-decoration:underline}
.ghb-pill-ok{color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 13%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 35%,transparent)}
.ghb-pill-warn{color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 14%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 35%,transparent)}
.ghb-pill-bad{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 13%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 35%,transparent)}
.ghb-pill-idle{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2)}
.ghb-dot{width:7px;height:7px;border-radius:50%;background:currentColor;flex-shrink:0}
.ghb-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.ghb-two{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px}
.ghb-stat{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:12px;padding:12px 14px;transition:transform .15s ease,border-color .15s ease,box-shadow .15s ease;cursor:default}
.ghb-stat:hover{transform:translateY(-2px);border-color:var(--dsw-alias-border-l2);box-shadow:0 4px 14px rgba(0,0,0,.09)}
.ghb-stat-icon{display:inline-flex;width:26px;height:26px;border-radius:8px;align-items:center;justify-content:center;background:var(--dsw-alias-bg-layer-2);flex-shrink:0}
.ghb-stat-value{font-size:22px;font-weight:700;margin-top:9px;letter-spacing:-.01em}
.ghb-stat-label{color:var(--dsw-alias-label-secondary);font-size:12px;margin-top:2px}
.ghb-sechead{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600;letter-spacing:.05em;color:var(--dsw-alias-label-secondary);text-transform:uppercase;margin-bottom:6px}
.ghb-badge{border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:0 8px;font-size:11px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.ghb-list{display:flex;flex-direction:column}
.ghb-item{display:flex;align-items:baseline;gap:10px;padding:8px 10px;margin:1px -10px;border-radius:8px;transition:background .12s}
.ghb-item:hover{background:var(--dsw-alias-bg-layer-2)}
.ghb-item-num{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;color:var(--dsw-alias-label-secondary);flex-shrink:0}
.ghb-item-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ghb-item-title a{color:inherit;text-decoration:none}
.ghb-item-title a:hover{color:var(--dsw-alias-brand-primary)}
.ghb-item-meta{color:var(--dsw-alias-label-secondary);white-space:nowrap;flex-shrink:0;font-size:12px}
.ghb-label{display:inline-block;border:1px solid var(--dsw-alias-border-l1);border-radius:5px;padding:0 5px;font-size:10.5px;color:var(--dsw-alias-label-secondary);margin-right:4px;vertical-align:baseline}
.ghb-sha{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11.5px;padding:1px 7px;border-radius:6px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);text-decoration:none;flex-shrink:0;transition:color .12s,border-color .12s}
.ghb-sha:hover{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.ghb-commit-subject{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ghb-commit-meta{color:var(--dsw-alias-label-secondary);white-space:nowrap;flex-shrink:0;font-size:12px}
.ghb-footer{display:flex;align-items:center;gap:14px;flex-wrap:wrap;color:var(--dsw-alias-label-secondary);font-size:12px;border-top:1px solid var(--dsw-alias-border-l1);padding-top:12px}
.ghb-spinner{width:14px;height:14px;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-label-primary);border-radius:50%;animation:ghb-rotate .7s linear infinite;display:inline-block;flex-shrink:0}
.ghb-spinner-lg{width:26px;height:26px;border-width:3px}
@keyframes ghb-rotate{to{transform:rotate(360deg)}}
.ghb-center{min-height:180px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px}
.ghb-empty{padding:16px 0 8px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:12.5px}
.ghb-overlay{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;background:var(--dsw-alias-bg-overlay);backdrop-filter:blur(2px)}
.ghb-modal{width:min(460px,92vw);border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:14px;padding:18px 20px;box-shadow:0 16px 48px rgba(0,0,0,.28);animation:ghb-pop .16s ease}
@keyframes ghb-pop{from{transform:scale(.97);opacity:0}}
.ghb-tabs{display:flex;gap:6px;margin:12px 0 14px}
.ghb-tab{flex:1;text-align:center;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);border-radius:8px;padding:6px 0;cursor:pointer;font-size:12px;color:var(--dsw-alias-label-primary);transition:border-color .15s}
.ghb-tab:hover{border-color:var(--dsw-alias-label-secondary)}
.ghb-tab-active{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);font-weight:600}
.ghb-input{width:100%;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-radius:8px;padding:7px 10px;font-size:12px}
.ghb-code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:24px;font-weight:700;letter-spacing:4px;text-align:center;padding:12px;border:1px dashed var(--dsw-alias-border-l2);border-radius:10px;margin:10px 0;background:var(--dsw-alias-bg-layer-2)}
`

    /** GitHub 徽标（描边继承 currentColor） */
    function GitHubMark({ size = 18 }) {
      return h(
        'svg',
        { viewBox: '0 0 16 16', width: size, height: size, 'aria-hidden': true, fill: 'currentColor' },
        h('path', {
          d: 'M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z',
        }),
      )
    }

    /** 小图标集（octicon 路径，fill=currentColor） */
    const ICON_PATHS = {
      star:
        'M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z',
      fork:
        'M5 5.372v.878c0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75v-.878a2.25 2.25 0 1 1 1.5 0v.878a2.25 2.25 0 0 1-2.25 2.25h-1.5v2.128a2.251 2.251 0 1 1-1.5 0V8.5h-1.5A2.25 2.25 0 0 1 3.5 6.25v-.878a2.25 2.25 0 1 1 1.5 0ZM5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Zm6.75.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm-3 8.75.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Z',
      issue:
        'M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z',
      pr: 'M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z',
      commit:
        'M11.93 8.5a4.002 4.002 0 0 1-7.86 0H.75a.75.75 0 0 1 0-1.5h3.32a4.002 4.002 0 0 1 7.86 0h3.32a.75.75 0 0 1 0 1.5Zm-1.43-.75a2.5 2.5 0 1 0-5 0 2.5 2.5 0 0 0 5 0Z',
    }
    function OctIcon({ name, size = 12 }) {
      return h(
        'svg',
        { viewBox: '0 0 16 16', width: size, height: size, 'aria-hidden': true, fill: 'currentColor' },
        h('path', { d: ICON_PATHS[name] ?? '' }),
      )
    }

    /** 1200 → "1.2k"；字符串（如 "5+"）原样；非数字 → "—" */
    const fmt = (n) => {
      if (typeof n === 'string') return n
      if (typeof n !== 'number' || !Number.isFinite(n)) return '—'
      if (n >= 1000) {
        const k = (n / 1000).toFixed(1).replace(/\.0$/, '')
        return `${k}k`
      }
      return String(n)
    }

    /** ISO 时间 → 相对时间（本地 git 的 %ar 已是相对文本，直接透传） */
    const looksIso = (s) => typeof s === 'string' && /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)
    function relTime(value) {
      if (!value) return ''
      if (!looksIso(value)) return value
      const ms = Date.now() - new Date(value).getTime()
      if (!Number.isFinite(ms) || ms < 0) return t('time.justNow')
      const s = Math.floor(ms / 1000)
      if (s < 60) return t('time.justNow')
      const m = Math.floor(s / 60)
      if (m < 60) return t('time.minAgo').replace('{n}', m)
      const hr = Math.floor(m / 60)
      if (hr < 24) return t('time.hourAgo').replace('{n}', hr)
      const d = Math.floor(hr / 24)
      if (d < 7) return t('time.dayAgo').replace('{n}', d)
      const w = Math.floor(d / 7)
      if (w < 5) return t('time.weekAgo').replace('{n}', w)
      const mo = Math.floor(d / 30)
      if (mo < 12) return t('time.monthAgo').replace('{n}', mo)
      return t('time.yearAgo').replace('{n}', Math.floor(d / 365))
    }

    /** 概览统计卡：彩色图标 + 数值 + 标签，悬浮微抬 */
    function Stat({ icon, iconColor, value, label }) {
      return h(
        'div',
        { className: 'ghb-stat' },
        h('span', { className: 'ghb-stat-icon', style: iconColor ? { color: iconColor } : undefined }, h(OctIcon, { name: icon, size: 14 })),
        h('div', { className: 'ghb-stat-value' }, value),
        h('div', { className: 'ghb-stat-label' }, label),
      )
    }

    /** 区块标题：小图标 + 大写标题 + 计数徽章 */
    function SecHead({ icon, title, count }) {
      return h(
        'div',
        { className: 'ghb-sechead' },
        icon ? h(OctIcon, { name: icon, size: 13 }) : null,
        h('span', null, title),
        count !== undefined && count !== null ? h('span', { className: 'ghb-badge' }, fmt(count)) : null,
      )
    }

    /** 列表行（PR / Issue 共用）：#num + 标签 + 标题链接 + 元信息 */
    function ListItem({ number, title, htmlUrl, meta, labels }) {
      return h(
        'div',
        { className: 'ghb-item' },
        h('span', { className: 'ghb-item-num' }, `#${number}`),
        h(
          'span',
          { className: 'ghb-item-title' },
          (labels ?? []).map((l, i) => h('span', { className: 'ghb-label', key: i }, l)),
          htmlUrl ? h('a', { href: htmlUrl, target: '_blank', rel: 'noreferrer', title: title }, title) : title,
        ),
        h('span', { className: 'ghb-item-meta' }, meta),
      )
    }

    /** 登录弹层：设备授权 + PAT 粘贴 */
    function AuthModal({ onClose, onDone, snap }) {
      const [tab, setTab] = React.useState('device')
      const [device, setDevice] = React.useState(null) // null | {state:'pending'|'authorized'|'error', userCode?, verificationUri?, error?}
      const [copied, setCopied] = React.useState(false)
      const [pat, setPat] = React.useState('')
      const [patBusy, setPatBusy] = React.useState(false)
      const [patError, setPatError] = React.useState(null)

      const startDevice = async () => {
        try {
          const res = await fetch(`${BASE}/auth/start`, { method: 'POST' })
          const data = await res.json()
          if (data.error) setDevice({ state: 'error', error: data.error })
          else setDevice({ state: 'pending', userCode: data.userCode, verificationUri: data.verificationUri })
        } catch (e) {
          setDevice({ state: 'error', error: 'start-failed', detail: String(e?.message ?? e) })
        }
      }

      const cancelDevice = async () => {
        try {
          await fetch(`${BASE}/auth/cancel`, { method: 'POST' })
        } catch {
          /* 服务不可达则直接复位 */
        }
        setDevice(null)
      }

      const copyCode = async () => {
        try {
          await navigator.clipboard.writeText(device.userCode)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {
          /* 剪贴板不可用时忽略 */
        }
      }

      // 设备流等待：5s 轮询 /auth/status；授权成功即回调关闭
      React.useEffect(() => {
        if (device?.state !== 'pending') return undefined
        let stopped = false
        const tick = async () => {
          try {
            const res = await fetch(`${BASE}/auth/status`)
            const data = await res.json()
            if (stopped) return
            if (data.state === 'authorized') {
              setDevice({ state: 'authorized' })
              setTimeout(() => onDone(), 700)
            } else if (data.state === 'error') {
              setDevice({ state: 'error', error: data.error })
            } else if (data.state === 'none') {
              setDevice(null) // 会话被其它入口取消
            }
          } catch {
            /* 下一轮重试 */
          }
        }
        const id = setInterval(tick, AUTH_POLL_MS)
        return () => {
          stopped = true
          clearInterval(id)
        }
      }, [device?.state, onDone])

      const savePat = async () => {
        const token = pat.trim()
        if (!token || patBusy) return
        setPatBusy(true)
        setPatError(null)
        try {
          const res = await fetch(`${BASE}/auth/token`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ token }),
          })
          const data = await res.json()
          if (res.ok && data.ok) {
            setPat('')
            onDone()
          } else {
            setPatError(data?.error === 'invalid-token' ? t('auth.pat.invalid') : String(data?.error ?? res.status))
          }
        } catch (e) {
          setPatError(String(e?.message ?? e))
        } finally {
          setPatBusy(false)
        }
      }

      const deviceErrorText =
        device?.state === 'error'
          ? t(`auth.device.error.${device.error}`) !== `auth.device.error.${device.error}`
            ? t(`auth.device.error.${device.error}`)
            : (device.error ?? 'error')
          : null

      return h(
        'div',
        { className: 'ghb-overlay', onClick: (e) => e.target === e.currentTarget && onClose() },
        h(
          'div',
          { className: 'ghb-modal' },
          h('style', null, STYLE),
          h(
            'div',
            { className: 'ghb-head' },
            h(GitHubMark, { size: 20 }),
            h('span', { style: { fontWeight: 600, fontSize: 14 } }, t('auth.login')),
            h('span', { className: 'ghb-spacer' }),
            h('button', { className: 'ghb-btn', onClick: onClose }, t('auth.close')),
          ),
          h('div', { className: 'ghb-muted', style: { marginTop: 10, fontSize: 12, lineHeight: 1.6 } }, t('auth.intro')),
          snap?.auth?.method === 'gh' || snap?.auth?.method === 'config'
            ? h('div', { className: 'ghb-pill ghb-pill-ok', style: { marginTop: 10 } }, h('span', { className: 'ghb-dot' }), t('auth.ghActive'))
            : null,
          h(
            'div',
            { className: 'ghb-tabs' },
            h('div', { className: `ghb-tab ${tab === 'device' ? 'ghb-tab-active' : ''}`, onClick: () => setTab('device') }, t('auth.tab.device')),
            h('div', { className: `ghb-tab ${tab === 'pat' ? 'ghb-tab-active' : ''}`, onClick: () => setTab('pat') }, t('auth.tab.pat')),
          ),
          tab === 'device'
            ? h(
                'div',
                null,
                device === null || device.state === 'error'
                  ? h(
                      'div',
                      { className: 'ghb-row', style: { marginTop: 6 } },
                      h('button', { className: 'ghb-btn ghb-btn-primary', onClick: startDevice }, t(device?.state === 'error' ? 'auth.device.retry' : 'auth.device.start')),
                      deviceErrorText ? h('span', { className: 'ghb-bad', style: { fontSize: 12 } }, deviceErrorText) : null,
                    )
                  : device.state === 'pending'
                    ? h(
                        'div',
                        null,
                        h('div', { className: 'ghb-muted', style: { marginTop: 8, fontSize: 12 } }, t('auth.device.step1')),
                        h(
                          'div',
                          { style: { marginTop: 6 } },
                          h('a', { className: 'ghb-btn ghb-btn-primary', href: device.verificationUri, target: '_blank', rel: 'noreferrer' }, `↗ ${t('auth.device.open')}`),
                        ),
                        h('div', { className: 'ghb-muted', style: { marginTop: 12, fontSize: 12 } }, t('auth.device.step2')),
                        h(
                          'div',
                          { className: 'ghb-row' },
                          h('div', { className: 'ghb-code', style: { flex: 1 } }, device.userCode),
                          h('button', { className: 'ghb-btn', onClick: copyCode, title: t('auth.device.copy') }, copied ? t('auth.device.copied') : `⧉ ${t('auth.device.copy')}`),
                        ),
                        h(
                          'div',
                          { className: 'ghb-row', style: { marginTop: 12 } },
                          h('span', { className: 'ghb-spinner' }),
                          h('span', { className: 'ghb-muted' }, t('auth.device.waiting')),
                          h('span', { className: 'ghb-spacer' }),
                          h('button', { className: 'ghb-btn', onClick: cancelDevice }, t('auth.device.cancel')),
                        ),
                      )
                    : h('div', { className: 'ghb-pill ghb-pill-ok', style: { marginTop: 10 } }, h('span', { className: 'ghb-dot' }), t('auth.device.success')),
              )
            : h(
                'div',
                null,
                h('div', { className: 'ghb-muted', style: { fontSize: 12, marginBottom: 7 } }, t('auth.pat.input')),
                h('input', {
                  className: 'ghb-input',
                  type: 'password',
                  value: pat,
                  placeholder: 'ghp_… / github_pat_…',
                  onChange: (e) => setPat(e.target.value),
                  onKeyDown: (e) => e.key === 'Enter' && savePat(),
                  autoFocus: true,
                }),
                h(
                  'div',
                  { className: 'ghb-row', style: { marginTop: 10 } },
                  h('button', { className: 'ghb-btn ghb-btn-primary', onClick: savePat, disabled: patBusy || !pat.trim() },
                    patBusy ? h('span', { className: 'ghb-spinner', style: { width: 12, height: 12 } }) : null,
                    t('auth.pat.save')),
                  patError ? h('span', { className: 'ghb-bad', style: { fontSize: 12 } }, patError) : null,
                ),
                h('div', { className: 'ghb-muted', style: { marginTop: 10, fontSize: 12, lineHeight: 1.6 } }, t('auth.pat.hint')),
              ),
        ),
      )
    }

    /** 看板主面板 */
    function GitHubBoard() {
      const [phase, setPhase] = React.useState('loading') // loading | ready | error
      const [snap, setSnap] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [refreshing, setRefreshing] = React.useState(false)
      const [repo, setRepo] = React.useState('') // 当前选择的 'owner/name'（空 = 缺省当前项目）
      const [showAuth, setShowAuth] = React.useState(false)
      const repoRef = React.useRef('')

      const load = React.useCallback(async (repoParam) => {
        const target = repoParam !== undefined ? repoParam : repoRef.current
        try {
          const res = await fetch(`${BASE}/status${target ? `?repo=${encodeURIComponent(target)}` : ''}`)
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const data = await res.json()
          setSnap(data)
          setPhase('ready')
          setError(null)
          // 回读实际生效的仓库（参数无效回落当前项目）
          const effective = data?.selected?.repo ?? ''
          if (effective !== repoRef.current) {
            repoRef.current = effective
            setRepo(effective)
          }
        } catch (e) {
          setError(String(e?.message ?? e))
          setPhase('error')
        }
      }, [])

      React.useEffect(() => {
        load()
        // 30 分钟自动轮询；卸载时无条件清理（资源泄漏纪律）
        const id = setInterval(() => load(), POLL_MS)
        return () => clearInterval(id)
      }, [load])

      const refresh = React.useCallback(async () => {
        if (refreshing) return
        setRefreshing(true)
        try {
          const res = await fetch(`${BASE}/refresh${repoRef.current ? `?repo=${encodeURIComponent(repoRef.current)}` : ''}`, { method: 'POST' })
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const data = await res.json()
          setSnap(data)
          setPhase('ready')
        } catch (e) {
          setError(String(e?.message ?? e))
          setPhase('error')
        } finally {
          setRefreshing(false)
        }
      }, [refreshing])

      const selectRepo = (value) => {
        repoRef.current = value
        setRepo(value)
        load(value)
      }

      const logout = async () => {
        try {
          await fetch(`${BASE}/auth/logout`, { method: 'POST' })
        } catch {
          /* 服务不可达时仍刷新本地视图 */
        }
        load()
      }

      if (phase === 'loading') {
        return h(
          'div',
          { className: 'ghb-root' },
          h('style', null, STYLE),
          h('div', { className: 'ghb-card ghb-center' }, h('span', { className: 'ghb-spinner ghb-spinner-lg' }), h('span', { className: 'ghb-muted' }, t('panel.loading'))),
        )
      }

      if (phase === 'error') {
        return h(
          'div',
          { className: 'ghb-root' },
          h('style', null, STYLE),
          h(
            'div',
            { className: 'ghb-card ghb-center' },
            h('span', { className: 'ghb-mark' }, h(GitHubMark, { size: 18 })),
            h('div', { style: { fontWeight: 600, color: 'var(--dsw-alias-state-error-primary)' } }, t('panel.error')),
            h('div', { className: 'ghb-muted' }, error),
            h('div', { className: 'ghb-muted' }, t('panel.hint')),
          ),
        )
      }

      if (!snap || snap.ok === false) {
        return h(
          'div',
          { className: 'ghb-root' },
          h('style', null, STYLE),
          h(
            'div',
            { className: 'ghb-card ghb-center' },
            h('span', { className: 'ghb-mark' }, h(GitHubMark, { size: 18 })),
            h('div', { style: { fontWeight: 600 } }, t('panel.notRepo')),
            h('div', { className: 'ghb-muted' }, String(snap?.repoDir ?? '')),
          ),
        )
      }

      const selected = snap.selected ?? {}
      const github = selected.github ?? { available: false }
      const local = selected.local
      const auth = snap.auth ?? {}
      const user = auth.user
      const repos = Array.isArray(snap.repos) ? snap.repos : []
      const webUrl = github.htmlUrl ?? selected.remote?.webUrl
      const slashAt = typeof selected.repo === 'string' ? selected.repo.indexOf('/') : -1
      const ownerName = slashAt > 0 ? selected.repo.slice(0, slashAt) : null
      const repoNameOnly = slashAt > 0 ? selected.repo.slice(slashAt + 1) : (selected.repo ?? t('repo.noRemote'))

      // 仓库选择器选项：当前项目 + 我的仓库；所选仓库不在列表时补一项
      const inList = repos.some((r) => r.fullName === repo)
      const commits = local?.commits ?? selected.commits ?? []
      const checks = selected.checks
      const release = selected.release
      const pulls = Array.isArray(selected.pulls) ? selected.pulls : []
      const issues = Array.isArray(selected.issues) ? selected.issues : []
      const updated = snap.fetchedAt ? new Date(snap.fetchedAt).toLocaleTimeString() : ''

      const ciPill =
        checks === null || checks === undefined
          ? null
          : h(
              'span',
              { className: `ghb-pill ${checks.state === 'success' ? 'ghb-pill-ok' : checks.state === 'failure' ? 'ghb-pill-bad' : checks.state === 'pending' ? 'ghb-pill-warn' : 'ghb-pill-idle'}` },
              h('span', { className: 'ghb-dot' }),
              `${t('ci.title')} ${t(`ci.${checks.state}`) !== `ci.${checks.state}` ? t(`ci.${checks.state}`) : checks.state}${checks.total ? ` · ${checks.total}` : ''}`,
            )

      return h(
        'div',
        { className: 'ghb-root' },
        h('style', null, STYLE),
        showAuth ? h(AuthModal, { snap, onClose: () => setShowAuth(false), onDone: () => { setShowAuth(false); load() } }) : null,
        h(
          'div',
          { className: 'ghb-wrap' },
          // ---- 头部：仓库 + 选择器 + 用户 + 刷新 ----
          h(
            'div',
            { className: 'ghb-card' },
            h(
              'div',
              { className: 'ghb-head' },
              h('span', { className: 'ghb-mark' }, h(GitHubMark, { size: 18 })),
              webUrl
                ? h(
                    'a',
                    { className: 'ghb-title', href: webUrl, target: '_blank', rel: 'noreferrer' },
                    ownerName ? h('span', { className: 'ghb-owner' }, `${ownerName}/`) : null,
                    h('span', { className: 'ghb-reponame' }, repoNameOnly),
                  )
                : h('span', { className: 'ghb-title' }, repoNameOnly),
              repos.length || repo
                ? h(
                    'select',
                    { className: 'ghb-select', title: t('repo.picker'), value: repo, onChange: (e) => selectRepo(e.target.value) },
                    !repo ? h('option', { value: '' }, t('repo.current')) : null,
                    repo && !inList ? h('option', { value: repo }, repo) : null,
                    repos.length
                      ? h(
                          'optgroup',
                          { label: t('repo.mine') },
                          repos.map((r) =>
                            h('option', { key: r.fullName, value: r.fullName }, `${r.private ? '🔒 ' : ''}${r.fullName}${typeof r.stars === 'number' ? ` ★${r.stars}` : ''}`),
                          ),
                        )
                      : h('option', { value: repo, disabled: true }, t('repo.none')),
                  )
                : null,
              h('span', { className: 'ghb-spacer' }),
              user
                ? h(
                    'span',
                    { className: 'ghb-row', style: { gap: 6 } },
                    user.htmlUrl
                      ? h(
                          'a',
                          { className: 'ghb-user', href: user.htmlUrl, target: '_blank', rel: 'noreferrer', title: user.name ?? user.login },
                          h('img', { src: user.avatarUrl ?? '', width: 20, height: 20, alt: '' }),
                          user.login,
                        )
                      : h('span', { className: 'ghb-user' }, h('img', { src: user.avatarUrl ?? '', width: 20, height: 20, alt: '' }), user.login),
                    auth.method === 'login'
                      ? h('button', { className: 'ghb-btn', style: { padding: '3px 10px' }, onClick: logout, title: t('auth.logout') }, '✕')
                      : h('span', { className: 'ghb-muted', style: { fontSize: 11 }, title: t(`auth.method.${auth.method ?? 'anon'}`) }, t(`auth.method.${auth.method}`) !== `auth.method.${auth.method}` ? t(`auth.method.${auth.method}`) : (auth.method ?? '')),
                  )
                : h('button', { className: 'ghb-btn', onClick: () => setShowAuth(true) }, t('auth.login')),
              h(
                'button',
                { className: 'ghb-btn', onClick: refresh, disabled: refreshing, title: t('refresh') },
                refreshing ? h('span', { className: 'ghb-spinner', style: { width: 12, height: 12 } }) : '⟳',
                t(refreshing ? 'refreshing' : 'refresh'),
              ),
            ),
            github.description ? h('div', { className: 'ghb-desc', title: github.description }, github.description) : null,
            // 元信息行：语言 / 许可 / 主题 / 可见性 / 默认分支
            h(
              'div',
              { className: 'ghb-metarow' },
              github.language ? h('span', { className: 'ghb-tag' }, `${t('meta.language')}: ${github.language}`) : null,
              github.license && github.license !== 'NOASSERTION' ? h('span', { className: 'ghb-tag' }, `${t('meta.license')}: ${github.license}`) : null,
              (github.topics ?? []).map((topic) => h('span', { className: 'ghb-tag', key: topic }, topic)),
              github.visibility ? h('span', { className: 'ghb-tag' }, github.visibility) : null,
              github.defaultBranch ? h('span', { className: 'ghb-tag' }, `${t('meta.default')}: ${github.defaultBranch}`) : null,
            ),
          ),
          // ---- 本地状态（仅当前项目仓库）----
          selected.matchesLocal && local
            ? h(
                'div',
                { className: 'ghb-card ghb-row' },
                local.upstream !== null && local.ahead !== null && local.behind !== null
                  ? local.ahead === 0 && local.behind === 0
                    ? h('span', { className: 'ghb-pill ghb-pill-ok' }, h('span', { className: 'ghb-dot' }), t('sync.synced'))
                    : h(
                        'span',
                        { className: `ghb-pill ${local.behind > 0 ? 'ghb-pill-warn' : 'ghb-pill-ok'}` },
                        local.ahead > 0 ? `↑ ${local.ahead} ${t('sync.ahead')}` : null,
                        local.ahead > 0 && local.behind > 0 ? ' · ' : null,
                        local.behind > 0 ? `↓ ${local.behind} ${t('sync.behind')}` : null,
                      )
                  : h('span', { className: 'ghb-pill ghb-pill-idle' }, t('sync.noUpstream')),
                h('span', { className: 'ghb-muted' }, '·'),
                h('span', { className: 'ghb-muted' }, `${t('wt.title')}:`),
                local.staged + local.unstaged + local.untracked > 0
                  ? h(
                      'span',
                      { className: 'ghb-row', style: { gap: 8 } },
                      local.staged > 0 ? h('span', { className: 'ghb-pill ghb-pill-warn' }, `● ${local.staged} ${t('wt.staged')}`) : null,
                      local.unstaged > 0 ? h('span', { className: 'ghb-pill ghb-pill-warn' }, `● ${local.unstaged} ${t('wt.unstaged')}`) : null,
                      local.untracked > 0 ? h('span', { className: 'ghb-pill ghb-pill-idle' }, `● ${local.untracked} ${t('wt.untracked')}`) : null,
                    )
                  : h('span', { className: 'ghb-pill ghb-pill-ok' }, h('span', { className: 'ghb-dot' }), t('wt.clean')),
                h('span', { className: 'ghb-spacer' }),
                ciPill,
                release
                  ? h(
                      'span',
                      { className: 'ghb-pill ghb-pill-idle' },
                      '🏷 ',
                      release.htmlUrl ? h('a', { href: release.htmlUrl, target: '_blank', rel: 'noreferrer' }, release.tag) : release.tag,
                      ` · ${relTime(release.publishedAt)}`,
                    )
                  : h('span', { className: 'ghb-pill ghb-pill-idle' }, `🏷 ${t('release.none')}`),
              )
            : null,
          // ---- GitHub 概览卡片 ----
          github.available
            ? h(
                'div',
                { className: 'ghb-grid' },
                h(Stat, { icon: 'star', iconColor: 'var(--dsw-alias-state-warn-primary)', value: fmt(github.stars), label: t('gh.stars') }),
                h(Stat, { icon: 'fork', iconColor: 'var(--dsw-alias-label-secondary)', value: fmt(github.forks), label: t('gh.forks') }),
                h(Stat, { icon: 'issue', iconColor: 'var(--dsw-alias-state-success-primary)', value: fmt(github.openIssues), label: t('gh.issues') }),
                h(Stat, { icon: 'pr', iconColor: 'var(--dsw-alias-brand-primary)', value: fmt(github.openPulls), label: t('gh.pulls') }),
              )
            : h(
                'div',
                { className: 'ghb-card ghb-muted' },
                `⚠ ${t('gh.unavailable')}`,
                github.reason ? ` — ${t(`gh.reason.${github.reason}`) !== `gh.reason.${github.reason}` ? t(`gh.reason.${github.reason}`) : github.reason}` : '',
              ),
          // ---- PR / Issue 列表（登录后可得）----
          github.available
            ? h(
                'div',
                { className: 'ghb-two' },
                h(
                  'div',
                  { className: 'ghb-card' },
                  h(SecHead, { icon: 'pr', title: t('pulls.title'), count: Array.isArray(selected.pulls) ? github.openPulls : undefined }),
                  !Array.isArray(selected.pulls)
                    ? h('div', { className: 'ghb-empty' }, '—')
                    : pulls.length === 0
                      ? h('div', { className: 'ghb-empty' }, t('pulls.empty'))
                      : h(
                          'div',
                          { className: 'ghb-list' },
                          pulls.map((p) =>
                            h(ListItem, {
                              key: p.number,
                              number: p.number,
                              title: `${p.draft ? `[${t('list.draft')}] ` : ''}${p.title}`,
                              htmlUrl: p.htmlUrl,
                              meta: `${p.author ?? ''} · ${t('list.updated')} ${relTime(p.updatedAt)}`,
                            }),
                          ),
                        ),
                ),
                h(
                  'div',
                  { className: 'ghb-card' },
                  h(SecHead, { icon: 'issue', title: t('issues.title'), count: Array.isArray(selected.issues) ? github.openIssues : undefined }),
                  !Array.isArray(selected.issues)
                    ? h('div', { className: 'ghb-empty' }, '—')
                    : issues.length === 0
                      ? h('div', { className: 'ghb-empty' }, t('issues.empty'))
                      : h(
                          'div',
                          { className: 'ghb-list' },
                          issues.map((i) =>
                            h(ListItem, {
                              key: i.number,
                              number: i.number,
                              title: i.title,
                              htmlUrl: i.htmlUrl,
                              labels: i.labels,
                              meta: `${t('list.updated')} ${relTime(i.updatedAt)}`,
                            }),
                          ),
                        ),
                ),
              )
            : null,
          // ---- 最近提交（当前项目=本地 git；其它仓库=API）----
          h(
            'div',
            { className: 'ghb-card' },
            h(
              'div',
              { className: 'ghb-sechead', style: { marginBottom: 4 } },
              h(OctIcon, { name: 'commit', size: 13 }),
              h('span', null, t('commits.title')),
              h('span', { className: 'ghb-badge' }, selected.matchesLocal ? t('commits.local') : t('commits.remote')),
            ),
            commits.length === 0
              ? h('div', { className: 'ghb-empty' }, t('commits.empty'))
              : h(
                  'div',
                  { className: 'ghb-list' },
                  commits.map((c) =>
                    h(
                      'div',
                      { className: 'ghb-item', key: c.sha },
                      webUrl
                        ? h('a', { className: 'ghb-sha', href: `${webUrl}/commit/${c.sha}`, target: '_blank', rel: 'noreferrer' }, c.short)
                        : h('span', { className: 'ghb-sha' }, c.short),
                      h('span', { className: 'ghb-commit-subject', title: c.subject }, c.subject),
                      h('span', { className: 'ghb-commit-meta' }, `${c.author} · ${relTime(c.date)}`),
                    ),
                  ),
                ),
          ),
          // ---- 页脚 ----
          h(
            'div',
            { className: 'ghb-footer' },
            updated ? h('span', null, `${t('updated')} ${updated}`, snap.fetchedAt ? h('span', { className: 'ghb-muted' }, `（${relTime(snap.fetchedAt)}）`) : null) : null,
            h('span', null, t('auto')),
            snap.rate ? h('span', null, `${t('rate')}: ${snap.rate.remaining}/${snap.rate.limit}`) : null,
            auth.method ? h('span', null, `🔑 ${t(`auth.method.${auth.method}`) !== `auth.method.${auth.method}` ? t(`auth.method.${auth.method}`) : auth.method}`) : null,
            snap.fetchError ? h('span', { className: 'ghb-warn' }, `⚠ ${t('refresh.failed')} (${snap.fetchError})`) : null,
          ),
        ),
      )
    }

    return {
      // 仅 slots 为硬依赖；locale 经 ctx.get 可选获取（动态装载环境的服务表可能不同，
      // 未声明服务的硬注入会让整个模块静默不激活）
      inject: ['slots'],
      apply(ctx) {
        const locale = typeof ctx.get === 'function' ? ctx.get('locale') : undefined
        if (locale && typeof locale.register === 'function') {
          try {
            ctx.effect(() => locale.register(NS, dict), 'github-board: dictionaries')
            t = locale.bind(NS)
          } catch {
            t = (key) => dict.zh[key] ?? key
          }
        } else {
          t = (key) => dict.zh[key] ?? key
        }

        // 侧边栏图标（id 与 main 面板 key 共享 → 点击切换面板）
        try {
          ctx.slots.inject('sidebar.panellist', () =>
            ctx.slots.register(
              { name: 'sidebar.panellist', id: PANEL_ID, order: 31, label: () => t('panel.title') },
              GitHubMark,
            ),
          )
        } catch (error) {
          console.error('[github-board] panellist registration failed:', error)
        }

        // 主面板：GitHub 看板（keyed 注册仅声明 key）
        try {
          ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, GitHubBoard))
        } catch (error) {
          console.error('[github-board] main registration failed:', error)
        }
      },
    }
  },
})
