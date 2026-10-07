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
 * @fileoverview DSH Host 半（GitHub 看板 v0.2）：授权登录 + 多仓库 + 富信息。
 *
 * 授权链（优先级从高到低，token 永不下发给客户端，仅返回用户身份摘要）：
 *   1. login  —— 面板发起的登录（GitHub 设备流或 PAT 粘贴），token 存插件目录 .auth.json
 *               （已加 .gitignore；PoC 级存储，生产版应迁移 DSH credentials 服务）
 *   2. config —— 插件配置 githubToken / 环境变量 GITHUB_TOKEN
 *   3. gh     —— 复用本机 `gh auth token`（5 分钟缓存），与 gh CLI 共享登录态
 *   4. 匿名   —— 公开仓库只读（60 req/h）
 *
 * 设备流（POST /auth/start）：github.com/login/device/code → 用户在验证页输入 user_code
 * → 轮询 login/oauth/access_token 至授权完成。需要在插件配置 oauthClientId（OAuth App，
 * 须在应用设置里启用 Device Flow）。
 *
 * 数据面：/status?repo=owner/name 返回完整快照 —— 登录身份、我的仓库列表、所选仓库的
 * 概览/stars/开放 PR 与 Issue 列表/最新 Release/CI 检查聚合/最近提交（本地或 API）；
 * 所选仓库为当前项目（repoDir 的 origin）时附带本地 git 状态（分支/领先落后/工作区）。
 * GitHub API 结果带 TTL 缓存并记录 x-ratelimit 余量。
 */
import { execFile } from 'node:child_process'
import http from 'node:http'
import https from 'node:https'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const exec = promisify(execFile)

/** 各命令超时（ms）：普通 git / git fetch（网络）/ GitHub API / 设备流请求 */
const GIT_TIMEOUT_MS = 12_000
const FETCH_TIMEOUT_MS = 45_000
const GITHUB_TIMEOUT_MS = 12_000
const DEVICE_TIMEOUT_MS = 15_000

/** 面板展示的最近提交条数 */
const COMMIT_LIMIT = 8

const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url))
const AUTH_FILE = path.join(PLUGIN_DIR, '.auth.json')

/** 设备流默认申请的 scope（repo=私有仓库读写面，read:user=身份；可经 oauthScope 配置收窄） */
const DEFAULT_SCOPE = 'repo read:user'

/** 从 git 远端 URL 解析 GitHub owner/repo（支持 SSH / scp 风格 / HTTPS 三种写法） */
function parseGitHubRemote(url) {
  if (typeof url !== 'string' || !url.trim()) return null
  const u = url.trim()
  let m = u.match(/^git@github\.com:([^/\s]+)\/(.+?)(?:\.git)?$/)
  if (m) return { owner: m[1], repo: m[2] }
  m = u.match(/^ssh:\/\/git@github\.com\/([^/\s]+)\/(.+?)(?:\.git)?$/)
  if (m) return { owner: m[1], repo: m[2] }
  m = u.match(/^https?:\/\/(?:[^@\s]+@)?github\.com\/([^/\s]+)\/([^#\s?]+?)(?:\.git)?$/)
  if (m) return { owner: m[1], repo: m[2] }
  return null
}

/** 'owner/name' 形态校验 */
function parseRepoParam(value) {
  if (typeof value !== 'string') return null
  const m = value.trim().match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/)
  return m ? { owner: m[1], repo: m[2] } : null
}

export function apply(ctx, config) {
  const repoDir = path.resolve(config.repoDir ?? process.cwd())
  const port = Number(config.port ?? 17861)
  const git = config.gitCommand ?? 'git'
  const configGithubToken = config.githubToken ?? process.env.GITHUB_TOKEN ?? null
  const oauthClientId = config.oauthClientId ?? null
  const oauthScope = config.oauthScope ?? DEFAULT_SCOPE
  const githubTtlMs = Math.max(15, Number(config.githubTtlSec ?? 60)) * 1000
  const reposTtlMs = Math.max(60, Number(config.reposTtlSec ?? 120)) * 1000
  const log = (...args) => console.log('[github-board]', ...args)

  /** 在 repoDir 执行一条 git 命令，返回 stdout（失败抛异常） */
  const git_ = (args, timeout = GIT_TIMEOUT_MS) =>
    exec(git, args, { cwd: repoDir, timeout, maxBuffer: 4 * 1024 * 1024, windowsHide: true }).then((r) => r.stdout)

  // ==================== 凭据存储（PoC：.auth.json，已 gitignore） ====================

  function readStoredAuth() {
    try {
      const data = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'))
      if (typeof data?.token === 'string' && data.token.trim()) return data
    } catch {
      /* 无文件或损坏均视为未登录 */
    }
    return null
  }

  function writeStoredAuth(data) {
    try {
      fs.writeFileSync(AUTH_FILE, JSON.stringify(data, null, 2), { mode: 0o600 })
    } catch (error) {
      log('persist auth failed:', error?.message ?? error)
    }
  }

  function clearStoredAuth() {
    try {
      fs.rmSync(AUTH_FILE, { force: true })
    } catch {
      /* 已不存在则忽略 */
    }
  }

  // ==================== gh CLI 凭据（5 分钟缓存） ====================

  let ghCache = { at: 0, token: null }
  async function ghToken() {
    if (Date.now() - ghCache.at < 5 * 60_000) return ghCache.token
    try {
      const out = (await exec('gh', ['auth', 'token'], { timeout: 10_000, windowsHide: true })).stdout.trim()
      ghCache = { at: Date.now(), token: out || null }
    } catch {
      ghCache = { at: Date.now(), token: null }
    }
    return ghCache.token
  }

  // ==================== GitHub HTTP 基础设施 ====================

  /** 最近一次 api.github.com 响应的速率限额（快照展示用） */
  let rateInfo = null

  function httpsJson({ host, port = 443, method = 'GET', pathname, token, form, timeout = GITHUB_TIMEOUT_MS }) {
    return new Promise((resolve, reject) => {
      const headers = { 'user-agent': 'dsh-github-board', accept: 'application/json' }
      let body = null
      if (token) headers.authorization = `Bearer ${token}`
      if (form) {
        body = new URLSearchParams(form).toString()
        headers['content-type'] = 'application/x-www-form-urlencoded'
        headers['content-length'] = Buffer.byteLength(body)
      }
      const req = https.request({ host, port, method, path: pathname, headers, timeout }, (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          // 顺手记录速率限额（登录后 5000/h，匿名 60/h）
          const limit = Number(res.headers['x-ratelimit-limit'])
          const remaining = Number(res.headers['x-ratelimit-remaining'])
          if (host === 'api.github.com' && Number.isFinite(limit) && Number.isFinite(remaining)) {
            rateInfo = { limit, remaining, at: Date.now() }
          }
          let json = null
          try {
            json = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          } catch {
            /* 非 JSON 响应按 null 处理 */
          }
          resolve({ status: res.statusCode ?? 0, json })
        })
      })
      req.on('timeout', () => req.destroy(new Error('github request timeout')))
      req.on('error', reject)
      if (body) req.write(body)
      req.end()
    })
  }

  const apiJson = (pathname, token) => httpsJson({ host: 'api.github.com', pathname, token })
  const loginJson = (pathname, form) =>
    httpsJson({ host: 'github.com', method: 'POST', pathname, form, timeout: DEVICE_TIMEOUT_MS })

  // ==================== 用户身份（token → 用户摘要，10 分钟缓存） ====================

  const userCache = new Map() // token → { at, user }
  async function userFor(token) {
    if (!token) return null
    const hit = userCache.get(token)
    if (hit && Date.now() - hit.at < 10 * 60_000) return hit.user
    let user = null
    try {
      const res = await apiJson('/user', token)
      if (res.status === 200 && res.json?.login) {
        user = {
          login: res.json.login,
          name: res.json.name ?? null,
          avatarUrl: res.json.avatar_url ?? null,
          htmlUrl: res.json.html_url ?? null,
        }
      }
    } catch {
      /* 网络失败 → null，调用方回退存储里的旧摘要 */
    }
    userCache.set(token, { at: Date.now(), user })
    return user
  }

  // ==================== 授权链解析 ====================

  async function resolveAuth() {
    const stored = readStoredAuth()
    if (stored?.token) {
      return { method: 'login', token: stored.token, user: (await userFor(stored.token)) ?? stored.user ?? null }
    }
    if (configGithubToken) {
      return { method: 'config', token: configGithubToken, user: await userFor(configGithubToken) }
    }
    const gh = await ghToken()
    if (gh) return { method: 'gh', token: gh, user: await userFor(gh) }
    return { method: null, token: null, user: null }
  }

  // ==================== 我的仓库列表（登录后） ====================

  let reposCache = { at: 0, value: null }
  async function fetchRepos(token, force = false) {
    if (!token) return null
    if (!force && reposCache.value && Date.now() - reposCache.at < reposTtlMs) return reposCache.value
    let value = null
    try {
      const res = await apiJson('/user/repos?per_page=100&sort=pushed', token)
      if (res.status === 200 && Array.isArray(res.json)) {
        value = res.json.map((r) => ({
          fullName: r.full_name,
          private: r.private === true,
          fork: r.fork === true,
          pushedAt: r.pushed_at ?? null,
          stars: r.stargazers_count ?? null,
          defaultBranch: r.default_branch ?? null,
          htmlUrl: r.html_url ?? null,
          description: typeof r.description === 'string' ? r.description : '',
        }))
      }
    } catch {
      value = null
    }
    reposCache = { at: Date.now(), value }
    return value
  }

  // ==================== 仓库详情包（概览 + PR + Issue + Release + CI + 提交） ====================

  /** CI 检查聚合：无检查→none；有未完成→pending；有失败→failure；其余→success */
  function aggregateChecks(payload) {
    if (!payload || typeof payload.total_count !== 'number' || payload.total_count === 0) return { state: 'none', total: 0 }
    const runs = Array.isArray(payload.check_runs) ? payload.check_runs : []
    const bad = ['failure', 'timed_out', 'cancelled', 'startup_failure']
    if (runs.some((r) => r?.status && r.status !== 'completed')) return { state: 'pending', total: payload.total_count }
    if (runs.some((r) => bad.includes(r?.conclusion))) return { state: 'failure', total: payload.total_count }
    if (runs.every((r) => ['success', 'skipped', 'neutral'].includes(r?.conclusion))) return { state: 'success', total: payload.total_count }
    return { state: 'other', total: payload.total_count }
  }

  let bundleCache = { key: '', at: 0, value: null }
  async function fetchRepoBundle(owner, repo, token, { force = false, includeCommits = true } = {}) {
    if (!owner || !repo) return null
    const key = `${owner}/${repo}|${token ? 'auth' : 'anon'}|${includeCommits ? 'c1' : 'c0'}`
    if (!force && bundleCache.key === key && bundleCache.value && Date.now() - bundleCache.at < githubTtlMs) {
      return bundleCache.value
    }

    const settled = (promise, map) => promise.then(map, () => null)

    let meta = null
    try {
      const res = await apiJson(`/repos/${owner}/${repo}`, token)
      if (res.status === 200 && res.json) meta = res.json
    } catch {
      /* 网络错误 → meta null */
    }

    if (!meta) {
      const value = {
        github: { available: false, reason: meta === null ? 'network-error' : 'not-found-or-private' },
        pulls: null,
        issues: null,
        release: null,
        checks: null,
        commits: null,
      }
      bundleCache = { key, at: Date.now(), value }
      return value
    }

    const defaultBranch = meta.default_branch ?? 'main'

    const [github, pulls, issues, release, checks, commits] = await Promise.all([
      Promise.resolve({
        available: true,
        reason: null,
        htmlUrl: meta.html_url ?? `https://github.com/${owner}/${repo}`,
        description: typeof meta.description === 'string' ? meta.description : '',
        visibility: meta.private ? 'private' : (meta.visibility ?? 'public'),
        defaultBranch,
        language: meta.language ?? null,
        license: meta.license?.spdx_id ?? null,
        topics: Array.isArray(meta.topics) ? meta.topics.slice(0, 6) : [],
        stars: meta.stargazers_count ?? null,
        forks: meta.forks_count ?? null,
        watchers: meta.subscribers_count ?? null,
        openIssuesTotal: meta.open_issues_count ?? null,
        pushedAt: meta.pushed_at ?? null,
        createdAt: meta.created_at ?? null,
      }),
      settled(apiJson(`/repos/${owner}/${repo}/pulls?state=open&per_page=5&sort=updated&direction=desc`, token), (res) =>
        res.status === 200 && Array.isArray(res.json)
          ? res.json.map((p) => ({
              number: p.number,
              title: p.title ?? '',
              author: p.user?.login ?? null,
              updatedAt: p.updated_at ?? null,
              draft: p.draft === true,
              htmlUrl: p.html_url ?? null,
            }))
          : null,
      ),
      settled(apiJson(`/repos/${owner}/${repo}/issues?state=open&per_page=16&sort=updated&direction=desc`, token), (res) => {
        if (res.status !== 200 || !Array.isArray(res.json)) return null
        return res.json
          .filter((i) => !i.pull_request) // issues 端点混入 PR，剔除
          .slice(0, 5)
          .map((i) => ({
            number: i.number,
            title: i.title ?? '',
            author: i.user?.login ?? null,
            updatedAt: i.updated_at ?? null,
            labels: Array.isArray(i.labels) ? i.labels.map((l) => l?.name).filter(Boolean).slice(0, 4) : [],
            htmlUrl: i.html_url ?? null,
          }))
      }),
      settled(apiJson(`/repos/${owner}/${repo}/releases/latest`, token), (res) =>
        res.status === 200 && res.json?.tag_name
          ? {
              tag: res.json.tag_name,
              name: res.json.name ?? res.json.tag_name,
              publishedAt: res.json.published_at ?? null,
              htmlUrl: res.json.html_url ?? null,
            }
          : null,
      ),
      settled(apiJson(`/repos/${owner}/${repo}/commits/${encodeURIComponent(defaultBranch)}/check-runs?per_page=50`, token), (res) =>
        res.status === 200 && res.json ? aggregateChecks(res.json) : null,
      ),
      includeCommits
        ? settled(apiJson(`/repos/${owner}/${repo}/commits?per_page=${COMMIT_LIMIT}`, token), (res) =>
            res.status === 200 && Array.isArray(res.json)
              ? res.json.map((c) => ({
                  sha: c.sha ?? '',
                  short: String(c.sha ?? '').slice(0, 7),
                  author: c.commit?.author?.name ?? c.author?.login ?? '',
                  date: c.commit?.author?.date ?? null, // ISO；客户端做相对化
                  subject: String(c.commit?.message ?? '').split('\n')[0] ?? '',
                  htmlUrl: c.html_url ?? null,
                }))
              : null,
          )
        : Promise.resolve(null),
    ])

    // 开放 PR 数（open_issues_count 混算 PR；有列表时精确求差，否则用概览计数兜底）
    const openPulls = Array.isArray(pulls)
      ? pulls.length === 5
        ? `${5}+`
        : pulls.length
      : (github.openIssuesTotal ?? null)
    const openIssues = Array.isArray(issues)
      ? issues.length === 5
        ? `${5}+`
        : issues.length
      : (github.openIssuesTotal ?? null)

    const value = {
      github: { ...github, openPulls, openIssues },
      pulls,
      issues,
      release,
      checks,
      commits,
    }
    bundleCache = { key, at: Date.now(), value }
    return value
  }

  // ==================== 本地 git（当前项目） ====================

  let remoteCache = { at: 0, value: null }
  async function readRemote() {
    if (remoteCache.value && Date.now() - remoteCache.at < 10_000) return remoteCache.value
    try {
      const url = (await git_(['remote', 'get-url', 'origin'])).trim()
      const parsed = parseGitHubRemote(url)
      const value = {
        url: url || null,
        owner: parsed?.owner ?? null,
        repo: parsed?.repo ?? null,
        webUrl: parsed ? `https://github.com/${parsed.owner}/${parsed.repo}` : null,
      }
      remoteCache = { at: Date.now(), value }
      return value
    } catch {
      const value = { url: null, owner: null, repo: null, webUrl: null }
      remoteCache = { at: Date.now(), value }
      return value
    }
  }

  /** 采集本地 git 状态；单项失败静默降级为 null/0 */
  async function collectLocal() {
    const local = {
      branch: null,
      upstream: null,
      ahead: null,
      behind: null,
      head: null,
      headSubject: null,
      staged: 0,
      unstaged: 0,
      untracked: 0,
      commits: [],
    }
    await Promise.all([
      git_(['branch', '--show-current'])
        .then((b) => { local.branch = b.trim() || null })
        .catch(() => {}),
      git_(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'])
        .then((u) => { local.upstream = u.trim() || null })
        .catch(() => {}),
      git_(['rev-parse', '--short', 'HEAD'])
        .then((s) => { local.head = s.trim() || null })
        .catch(() => {}),
      git_(['log', '-n', '1', '--pretty=format:%s'])
        .then((s) => { local.headSubject = s.split('\n')[0] || null })
        .catch(() => {}),
      // "behind\tahead" 两个计数（@{upstream} 在左侧）；无上游时失败 → 保持 null
      git_(['rev-list', '--left-right', '--count', '@{upstream}...HEAD'])
        .then((c) => {
          const [behind, ahead] = c.trim().split(/\s+/).map(Number)
          if (Number.isInteger(behind) && Number.isInteger(ahead)) {
            local.behind = behind
            local.ahead = ahead
          }
        })
        .catch(() => {}),
      // porcelain v1 两列状态码：列1=暂存区 列2=工作区，?? 行计入未跟踪
      git_(['status', '--porcelain=v1'])
        .then((text) => {
          for (const line of text.split('\n')) {
            if (!line) continue
            if (line.startsWith('??')) local.untracked++
            else {
              if (line[0] !== ' ') local.staged++
              if (line[1] !== ' ') local.unstaged++
            }
          }
        })
        .catch(() => {}),
      // 字段间用 \x1f 分隔，避免与提交信息中的任意字符冲突
      git_(['log', '-n', String(COMMIT_LIMIT), '--pretty=format:%H%x1f%h%x1f%an%x1f%ar%x1f%s'])
        .then((text) => {
          local.commits = text
            .split('\n')
            .filter(Boolean)
            .map((line) => {
              const [sha, short, author, date, subject] = line.split('\x1f')
              return { sha, short, author, date, subject, htmlUrl: null }
            })
        })
        .catch(() => {}),
    ])
    return local
  }

  // ==================== 设备流登录会话 ====================

  let deviceSession = null

  async function startDevice() {
    if (!oauthClientId) return { error: 'no-client-id' }
    if (deviceSession && !deviceSession.settled) {
      return { userCode: deviceSession.userCode, verificationUri: deviceSession.verificationUri }
    }
    const res = await loginJson('/login/device/code', { client_id: oauthClientId, scope: oauthScope })
    if (res.status !== 200 || !res.json?.device_code) {
      return { error: 'start-failed', detail: String(res.json?.error_description ?? res.json?.error ?? `http-${res.status}`) }
    }
    const session = {
      deviceCode: res.json.device_code,
      userCode: res.json.user_code ?? '',
      verificationUri: res.json.verification_uri ?? 'https://github.com/login/device',
      intervalMs: Math.max(3, Number(res.json.interval ?? 5)) * 1000,
      expiresAt: Date.now() + Math.max(60, Number(res.json.expires_in ?? 900)) * 1000,
      settled: false,
      cancelled: false,
      error: null,
      token: null,
    }
    deviceSession = session
    // 轮询在后台进行；面板经 /auth/status 观察结果
    pollDevice(session).catch((e) => log('device poll crashed:', e?.message ?? e))
    return { userCode: session.userCode, verificationUri: session.verificationUri }
  }

  async function pollDevice(session) {
    while (!session.cancelled && !session.settled && Date.now() < session.expiresAt) {
      await new Promise((r) => setTimeout(r, session.intervalMs))
      if (session.cancelled || session.settled) return
      let res
      try {
        res = await loginJson('/login/oauth/access_token', {
          client_id: oauthClientId,
          device_code: session.deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        })
      } catch {
        continue // 网络抖动 → 继续等下一轮
      }
      if (res.status === 200 && res.json?.access_token) {
        session.token = res.json.access_token
        session.settled = true
        const user = await userFor(session.token)
        writeStoredAuth({ token: session.token, user, at: new Date().toISOString() })
        log('device-flow login ok:', user?.login ?? '(user unknown)')
        return
      }
      const error = res.json?.error ?? ''
      if (error === 'authorization_pending') continue
      if (error === 'slow_down') {
        session.intervalMs += 5000
        continue
      }
      session.error = error || `http-${res.status}`
      session.settled = true
      return
    }
    if (!session.settled && !session.cancelled) {
      session.error = 'expired-token'
      session.settled = true
    }
  }

  function deviceStatus() {
    const s = deviceSession
    if (!s) return { state: 'none' }
    if (!s.settled) return { state: 'pending', userCode: s.userCode, verificationUri: s.verificationUri }
    if (s.token) return { state: 'authorized' }
    return { state: 'error', error: s.error ?? 'unknown' }
  }

  // ==================== 快照组装 ====================

  async function buildSnapshot({ repo: requested, doFetch = false } = {}) {
    let repoError = null
    try {
      await git_(['rev-parse', '--is-inside-work-tree'])
    } catch (error) {
      repoError = `not-a-git-repo (${String(error?.message ?? error).split('\n')[0]})`
    }

    const localRemote = repoError ? { url: null, owner: null, repo: null, webUrl: null } : await readRemote()

    // 所选仓库：显式 'owner/name' 参数优先，缺省回落当前项目
    const parsed = parseRepoParam(requested)
    const selected = parsed ?? (localRemote.owner ? { owner: localRemote.owner, repo: localRemote.repo } : null)
    const matchesLocal =
      !!selected && !!localRemote.owner && selected.owner === localRemote.owner && selected.repo === localRemote.repo

    let fetchError = null
    if (doFetch && !repoError) {
      try {
        await git_(['fetch', '--quiet', 'origin'], FETCH_TIMEOUT_MS)
      } catch (error) {
        fetchError = String(error?.stderr || error?.message || error).split('\n')[0]
      }
    }

    const auth = await resolveAuth()

    const [local, bundle, repos] = await Promise.all([
      matchesLocal && !repoError ? collectLocal() : Promise.resolve(null),
      selected ? fetchRepoBundle(selected.owner, selected.repo, auth.token, { force: doFetch, includeCommits: !matchesLocal }) : Promise.resolve(null),
      auth.token ? fetchRepos(auth.token, doFetch) : Promise.resolve(null),
    ])

    return {
      ok: !repoError,
      error: repoError,
      repoDir,
      port,
      fetchedAt: new Date().toISOString(),
      didFetch: doFetch,
      fetchError,
      auth: { method: auth.method, user: auth.user },
      rate: rateInfo && Date.now() - rateInfo.at < 10 * 60_000 ? { limit: rateInfo.limit, remaining: rateInfo.remaining } : null,
      repos,
      selected: selected
        ? {
            repo: `${selected.owner}/${selected.repo}`,
            matchesLocal,
            remote: matchesLocal
              ? localRemote
              : { url: null, owner: selected.owner, repo: selected.repo, webUrl: `https://github.com/${selected.owner}/${selected.repo}` },
            local,
            ...bundle,
          }
        : null,
    }
  }

  // 并发去重：同一时刻多次 /status（或 /refresh）共享同一次采集
  let inflightStatus = null
  let inflightRefresh = null
  const statusOnce = (repo) => {
    inflightStatus ??= buildSnapshot({ repo }).finally(() => { inflightStatus = null })
    return inflightStatus
  }
  const refreshOnce = (repo) => {
    inflightRefresh ??= buildSnapshot({ repo, doFetch: true }).finally(() => { inflightRefresh = null })
    return inflightRefresh
  }

  // ==================== HTTP 服务 ====================

  const CORS = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '600',
  }

  /** 读取请求体（上限 4KB，仅 /auth/token 的小 JSON） */
  const readBody = (req, cap = 4096) =>
    new Promise((resolve, reject) => {
      let size = 0
      const chunks = []
      req.on('data', (c) => {
        size += c.length
        if (size > cap) {
          reject(new Error('body too large'))
          req.destroy()
          return
        }
        chunks.push(c)
      })
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      req.on('error', reject)
    })

  async function handle(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1')
    const headers = { ...CORS, 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' }
    const pathname = url.pathname

    // 跨源预检（POST /auth/* 与 POST /refresh）
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS)
      res.end()
      return
    }

    if (pathname === '/health' && req.method === 'GET') {
      res.writeHead(200, headers)
      res.end(JSON.stringify({ ok: true, repoDir, port }))
      return
    }

    if (pathname === '/status' && req.method === 'GET') {
      res.writeHead(200, headers)
      res.end(JSON.stringify(await statusOnce(url.searchParams.get('repo'))))
      return
    }

    if (pathname === '/refresh' && (req.method === 'POST' || req.method === 'GET')) {
      res.writeHead(200, headers)
      res.end(JSON.stringify(await refreshOnce(url.searchParams.get('repo'))))
      return
    }

    // ---- 授权端点 ----

    if (pathname === '/auth/status' && req.method === 'GET') {
      const auth = await resolveAuth()
      res.writeHead(200, headers)
      res.end(JSON.stringify({ ...deviceStatus(), auth: { method: auth.method, user: auth.user } }))
      return
    }

    if (pathname === '/auth/start' && req.method === 'POST') {
      try {
        const started = await startDevice()
        res.writeHead(started.error ? 400 : 200, headers)
        res.end(JSON.stringify(started))
      } catch (error) {
        res.writeHead(500, headers)
        res.end(JSON.stringify({ error: 'start-failed', detail: String(error?.message ?? error) }))
      }
      return
    }

    if (pathname === '/auth/cancel' && req.method === 'POST') {
      if (deviceSession && !deviceSession.settled) deviceSession.cancelled = true
      res.writeHead(200, headers)
      res.end(JSON.stringify({ ok: true }))
      return
    }

    if (pathname === '/auth/token' && req.method === 'POST') {
      let token = null
      try {
        const body = JSON.parse(await readBody(req))
        token = typeof body?.token === 'string' ? body.token.trim() : null
      } catch {
        token = null
      }
      if (!token) {
        res.writeHead(400, headers)
        res.end(JSON.stringify({ ok: false, error: 'no-token' }))
        return
      }
      const user = await userFor(token)
      if (!user) {
        res.writeHead(401, headers)
        res.end(JSON.stringify({ ok: false, error: 'invalid-token' }))
        return
      }
      writeStoredAuth({ token, user, at: new Date().toISOString() })
      log('pat login ok:', user.login)
      res.writeHead(200, headers)
      res.end(JSON.stringify({ ok: true, user }))
      return
    }

    if (pathname === '/auth/logout' && req.method === 'POST') {
      clearStoredAuth()
      // 各类缓存一并失效（身份相关数据换人）
      reposCache = { at: 0, value: null }
      bundleCache = { key: '', at: 0, value: null }
      const auth = await resolveAuth()
      res.writeHead(200, headers)
      res.end(JSON.stringify({ ok: true, nextMethod: auth.method }))
      return
    }

    res.writeHead(404, headers)
    res.end(JSON.stringify({ ok: false, error: 'not found' }))
  }

  const server = http.createServer((req, res) => {
    Promise.resolve()
      .then(() => handle(req, res))
      .catch((error) => {
        log('request error:', error?.stack ?? error)
        try {
          res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, error: String(error?.message ?? error) }))
        } catch {
          /* 响应已开始则忽略 */
        }
      })
  })
  server.on('error', (error) => log('server error:', error?.message ?? error))

  return ctx.effect(
    () => {
      server.listen(port, '127.0.0.1', () => {
        log(`status endpoint on http://127.0.0.1:${port} (repo dir: ${repoDir})`)
      })
      return () => {
        if (deviceSession && !deviceSession.settled) deviceSession.cancelled = true
        try {
          server.close()
        } catch {
          /* 已关闭则忽略 */
        }
        log('disposed')
      }
    },
    'github-board: status endpoint',
  )
}
