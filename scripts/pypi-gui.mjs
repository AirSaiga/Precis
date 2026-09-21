#!/usr/bin/env node
/**
 * @fileoverview Precis PyPI 管理控制台 —— precis-cli 在 PyPI 上的发布状态巡检与验证的本地轻量 GUI
 *
 * 定位：发布（release-gui）之后的"后巡检"入口——四方版本对齐（本地 manifest / git tag /
 *       GitHub Release / PyPI）、发布历史与文件清单、CD pypi job 运行状态、下载统计、
 *       一键在干净 venv 安装线上真实包跑与 CI 同口径的冒烟验证。
 *
 * 边界：PyPI 无公开写 API（yank/删除只能网页操作、版本不可重传），本控制台是
 *       纯只读 + 本地验证设计，零凭证落盘（PyPI/pypistats 全公开免鉴权；GitHub 用
 *       公开 API，可选读 GITHUB_TOKEN/GH_TOKEN 环境变量提额，仅内存使用不持久化）。
 *
 * 技术形态：镜像 release-gui.mjs——零依赖（仅 Node 内置模块）HTTP 服务 + 单页 HTML
 *           （scripts/pypi-gui.html），子进程日志经 SSE 流式推送浏览器。
 *           纯函数与安全校验复用既有导出（单一实现，避免副本漂移）：
 *           release.mjs 的版本读取/semver 比较；release-gui.mjs 的输入白名单与来源校验。
 *
 * 用法: npm run pypi:gui [-- --port 17889 --no-open]
 *
 * 路由:
 *   GET  /              控制台页面
 *   GET  /api/state     聚合状态（PyPI 元数据 / CD 工作流 / 下载统计 / 本地版本，各源独立容错）
 *   GET  /api/events    SSE 日志与任务状态流（含历史回放）
 *   POST /api/run       执行动作（verify-pypi）——同一时刻只允许一个任务
 *   POST /api/kill      终止当前任务（进程树）
 *
 * 安全约束（逐条继承 release-gui 成文约束）:
 *   - 只绑定 127.0.0.1，不对外暴露
 *   - 客户端只能触发固定动作枚举；version 先经 validateVersionish 白名单正则再拼命令
 *   - POST 状态变更接口校验 Origin/Host（isLocalBrowserRequest），外源一律 403
 *   - 收到退出信号先显式终止任务子进程再退出
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
// 复用 release.mjs 纯函数（单一实现；被 import 无副作用）
import { MANIFESTS, readManifestVersion, compareSemver, latestVersionTag } from './release.mjs';
// 复用 release-gui.mjs 的输入白名单与来源校验（服务启动有"直接执行才跑 main"守卫，import 无副作用）
import { isLocalBrowserRequest, validateVersionish, stripAnsi, createLineSplitter } from './release-gui.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_PATH);
const ROOT = path.resolve(SCRIPT_DIR, '..');
const HTML_PATH = path.join(SCRIPT_DIR, 'pypi-gui.html');
const REPO_SLUG = 'AirSaiga/Precis';
const PYPI_PACKAGE = 'precis-cli';
const CD_WORKFLOW_NAME = 'CD - Build & Release';
const PYPI_JOB_NAME = 'Publish precis-cli to PyPI';
const DEFAULT_PORT = 17889;

// 外部数据源单源超时（allSettled 并发，单源慢不拖累整体）
const FETCH_TIMEOUT_MS = 6000;
const STATS_TIMEOUT_MS = 10000;
// 模块级 TTL 缓存：自动刷新不 hammer 外部 API
const CACHE_TTL = { pypi: 60_000, github: 60_000, stats: 300_000 };

// ============================================================================
// 纯函数（供 node --test 单元测试）
// ============================================================================

function requireVersion(v, field = 'version') {
  if (!validateVersionish(v)) throw new Error(`${field} 非法（仅允许 semver 字符）: ${v}`);
  return v;
}

/**
 * PyPI JSON API 的 releases 字典 → 按 semver 降序的版本数组。
 * 版本级 yanked = 该版本全部文件均被 yank；无文件的版本（已删文件）跳过。
 */
export function mapPypiReleases(json) {
  const releases = json?.releases ?? {};
  const out = [];
  for (const [version, files] of Object.entries(releases)) {
    if (!Array.isArray(files) || files.length === 0) continue;
    out.push({
      version,
      uploadTime: files.map((f) => f.upload_time_iso_8601 ?? f.upload_time ?? '').sort().pop() || null,
      yanked: files.every((f) => f.yanked === true),
      files: files.map((f) => ({
        name: f.filename,
        size: f.size,
        sha256: f.digests?.sha256 ?? null,
        kind: f.packagetype === 'sdist' || /\.tar\.gz$/.test(f.filename ?? '') ? 'sdist' : 'wheel',
      })),
    });
  }
  out.sort((a, b) => {
    try {
      return compareSemver(b.version, a.version);
    } catch {
      return String(b.version).localeCompare(String(a.version));
    }
  });
  return out;
}

/**
 * 四方版本对齐语义（控制台的核心判断）：
 *   本地 manifest（rootVersion + allConsistent） ↔ 最新 git tag ↔ GitHub Release ↔ PyPI 最新
 * 返回 { checks: [{key, label, status, detail}], overall }，overall 取最差档：
 *   error > warn > info > ok；任何一方缺失（如 GitHub 拉取失败）该检查记 unknown 不参与定档。
 */
export function computeAlignment({ rootVersion, allConsistent, latestTag, ghReleaseTag, pypiVersion }) {
  const checks = [];
  const tagVersion = latestTag ? latestTag.replace(/^v/, '') : null;
  const relVersion = ghReleaseTag ? ghReleaseTag.replace(/^v/, '') : null;
  const rank = { error: 3, warn: 2, info: 1, ok: 0 };

  // 1. manifest 内部一致性（rootVersion 读取失败时无法判断，记 unknown）
  if (!rootVersion) {
    checks.push({ key: 'manifests', label: '版本文件', status: 'unknown', detail: '版本文件读取失败（根 package.json 缺失或损坏？）' });
  } else if (allConsistent === false) {
    checks.push({ key: 'manifests', label: '版本文件', status: 'error', detail: `manifest 版本不一致（以根 package.json 为准逐个核对）` });
  } else {
    checks.push({ key: 'manifests', label: '版本文件', status: 'ok', detail: `全部 manifest 一致（${rootVersion}）` });
  }

  // 2. 本地 ↔ tag（本地领先是开发中正常态）
  if (!tagVersion) {
    checks.push({ key: 'local-tag', label: '本地 ↔ tag', status: 'info', detail: '仓库尚无 v* tag' });
  } else if (rootVersion === tagVersion) {
    checks.push({ key: 'local-tag', label: '本地 ↔ tag', status: 'ok', detail: `一致（${tagVersion}）` });
  } else {
    let diff = 'unknown';
    try {
      diff = compareSemver(rootVersion, tagVersion) > 0 ? 'ahead' : 'behind';
    } catch {
      diff = 'unknown';
    }
    checks.push(
      diff === 'ahead'
        ? { key: 'local-tag', label: '本地 ↔ tag', status: 'info', detail: `本地 ${rootVersion} 领先 tag ${tagVersion}（开发中，正常）` }
        : diff === 'behind'
          ? { key: 'local-tag', label: '本地 ↔ tag', status: 'error', detail: `本地 ${rootVersion} 落后 tag ${tagVersion}（tag 未合入当前分支？）` }
          : { key: 'local-tag', label: '本地 ↔ tag', status: 'unknown', detail: `本地 ${rootVersion} 与 tag ${tagVersion} 无法比较` },
    );
  }

  // 3. tag ↔ GitHub Release（tag 有而 Release 无 → CD 可能还在跑或失败）
  if (relVersion === null) {
    checks.push({ key: 'tag-release', label: 'tag ↔ GitHub', status: 'unknown', detail: 'GitHub Release 信息暂不可用' });
  } else if (!tagVersion) {
    checks.push({ key: 'tag-release', label: 'tag ↔ GitHub', status: 'unknown', detail: '本地无 tag，无法对齐' });
  } else if (relVersion === tagVersion) {
    checks.push({ key: 'tag-release', label: 'tag ↔ GitHub', status: 'ok', detail: `一致（${relVersion}）` });
  } else {
    let newer = false;
    try {
      newer = compareSemver(relVersion, tagVersion) > 0;
    } catch {
      /* 保持 false */
    }
    checks.push(
      newer
        ? { key: 'tag-release', label: 'tag ↔ GitHub', status: 'warn', detail: `GitHub Release（${relVersion}）高于本地 tag（${tagVersion}）` }
        : { key: 'tag-release', label: 'tag ↔ GitHub', status: 'warn', detail: `GitHub Release（${relVersion}）落后本地 tag（${tagVersion}）——CD 可能在跑或失败，见下方 job 状态` },
    );
  }

  // 4. tag ↔ PyPI（本控制台最关键的判断：tag 发了但 PyPI 没上 = pypi job 出问题）
  if (pypiVersion === null || pypiVersion === undefined) {
    checks.push({ key: 'tag-pypi', label: 'tag ↔ PyPI', status: 'unknown', detail: 'PyPI 信息暂不可用' });
  } else if (!tagVersion) {
    checks.push({ key: 'tag-pypi', label: 'tag ↔ PyPI', status: 'error', detail: `本地无 tag 但 PyPI 已有 ${pypiVersion}（未经仓库流程的发布？）` });
  } else if (pypiVersion === tagVersion) {
    checks.push({ key: 'tag-pypi', label: 'tag ↔ PyPI', status: 'ok', detail: `一致（${pypiVersion}）` });
  } else {
    let newer = false;
    try {
      newer = compareSemver(pypiVersion, tagVersion) > 0;
    } catch {
      /* 保持 false */
    }
    checks.push(
      newer
        ? { key: 'tag-pypi', label: 'tag ↔ PyPI', status: 'error', detail: `PyPI（${pypiVersion}）高于最新 tag（${tagVersion}）——存在未经仓库流程的发布` }
        : { key: 'tag-pypi', label: 'tag ↔ PyPI', status: 'warn', detail: `PyPI（${pypiVersion}）落后最新 tag（${tagVersion}）——pypi job 可能失败或仍在发布中，见下方 job 状态` },
    );
  }

  const known = checks.filter((c) => c.status !== 'unknown');
  const overall = known.reduce((worst, c) => (rank[c.status] > rank[worst] ? c.status : worst), 'ok');
  return { checks, overall: known.length === 0 ? 'unknown' : overall };
}

/**
 * pypistats 行数据（{category, downloads} 或含 date 的按日行）按 category 求和，降序取 Top N。
 * 排除 Total/空类别/畸形行；字符串 'null' 类别**保留**——pypistats 用它表示无法识别环境的下载
 * （无 Python 版本/系统信息，多为爬虫/安全扫描器/归档项目），是甄别真实用户量的关键信号，UI 单独标注。
 */
export function aggregateByCategory(rows, topN = 5) {
  const sums = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const cat = String(row?.category ?? '').trim();
    const dl = Number(row?.downloads);
    if (!cat || cat === 'Total' || !Number.isFinite(dl)) continue;
    sums.set(cat, (sums.get(cat) ?? 0) + dl);
  }
  return [...sums.entries()]
    .map(([category, downloads]) => ({ category, downloads }))
    .sort((a, b) => b.downloads - a.downloads)
    .slice(0, topN);
}

/** 解析 CHANGELOG.md 的 "## [X.Y.Z] - 日期" 小节头 → 版本号数组（跳过 Unreleased） */
export function parseChangelogVersions(md) {
  const versions = [];
  const re = /^## \[(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\]/gm;
  let m;
  while ((m = re.exec(String(md ?? ''))) !== null) {
    if (!versions.includes(m[1])) versions.push(m[1]);
  }
  return versions;
}

/**
 * pypistats /overall 端点返回的是"含镜像/不含镜像"两行总量（category 为 with_mirrors /
 * without_mirrors），**不是按版本分布**——pypistats 无 /version 端点（404）。映射为
 * { withMirrors, withoutMirrors }（各含 downloads 与数据日期，同 category 多行取最新日期）。
 */
export function mapOverallTotals(rows) {
  const pick = (cat) => {
    const hits = (Array.isArray(rows) ? rows : []).filter(
      (r) => r?.category === cat && Number.isFinite(Number(r?.downloads)),
    );
    if (hits.length === 0) return null;
    const latest = hits.reduce((a, b) => (String(b.date ?? '') > String(a.date ?? '') ? b : a));
    return { downloads: Number(latest.downloads), date: latest.date ?? null };
  };
  const withoutMirrors = pick('without_mirrors');
  const withMirrors = pick('with_mirrors');
  return withoutMirrors || withMirrors ? { withMirrors, withoutMirrors } : null;
}

/**
 * 把动作 + 参数拼装为受控 shell 命令（动作枚举只有 verify-pypi 一个）。
 * @returns {{ label: string, cmd: string, cwd: string }}
 * @throws 参数非法时抛错（未知动作 / 校验失败）
 */
export function buildPypiActionCommand(action, params = {}) {
  switch (action) {
    case 'verify-pypi': {
      const version = requireVersion(params.version);
      return {
        label: `验证线上包 ${PYPI_PACKAGE}==${version}`,
        cmd: `node scripts/verify-pypi-package.mjs --version ${version}`,
        cwd: ROOT,
      };
    }
    default:
      throw new Error(`未知动作: ${action}`);
  }
}

// ============================================================================
// 外部数据源（TTL 缓存 + 单源容错）
// ============================================================================

const cache = new Map();

async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function fetchJson(url, { timeoutMs = FETCH_TIMEOUT_MS, headers = {} } = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'precis-pypi-gui', Accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** GitHub API 公共头（公开仓库免鉴权可用；设了 GITHUB_TOKEN/GH_TOKEN 则提额，仅内存使用） */
function ghHeaders() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fetchPypiMeta() {
  return cached('pypi', CACHE_TTL.pypi, async () => {
    try {
      const json = await fetchJson(`https://pypi.org/pypi/${PYPI_PACKAGE}/json`);
      const releases = mapPypiReleases(json);
      return { latestVersion: json?.info?.version ?? null, releases };
    } catch (err) {
      return { error: `PyPI 元数据获取失败: ${err.message}` };
    }
  });
}

async function fetchGithubReleases() {
  return cached('gh-rel', CACHE_TTL.github, async () => {
    try {
      const list = await fetchJson(`https://api.github.com/repos/${REPO_SLUG}/releases?per_page=5`, { headers: ghHeaders() });
      return list.map((r) => ({ tag: r.tag_name, name: r.name, draft: r.draft, prerelease: r.prerelease, publishedAt: r.published_at }));
    } catch (err) {
      return { error: `GitHub Releases 获取失败: ${err.message}` };
    }
  });
}

/** 最新 tag 推送的 CD 运行 + 其中 pypi job 的状态 */
async function fetchWorkflow() {
  return cached('wf', CACHE_TTL.github, async () => {
    try {
      const runsJson = await fetchJson(
        `https://api.github.com/repos/${REPO_SLUG}/actions/runs?per_page=15`,
        { headers: ghHeaders() },
      );
      const tagRuns = (runsJson.workflow_runs ?? []).filter((r) => r.name === CD_WORKFLOW_NAME && r.event === 'push');
      const latest = tagRuns[0] ?? null;
      if (!latest) return { latestTagRun: null };
      let pypiJob = null;
      try {
        const jobsJson = await fetchJson(`https://api.github.com/repos/${REPO_SLUG}/actions/runs/${latest.id}/jobs`, {
          headers: ghHeaders(),
        });
        pypiJob = (jobsJson.jobs ?? []).find((j) => j.name === PYPI_JOB_NAME) ?? null;
      } catch {
        pypiJob = null;
      }
      return {
        latestTagRun: {
          tag: latest.head_branch,
          status: latest.status,
          conclusion: latest.conclusion,
          htmlUrl: latest.html_url,
          runNumber: latest.run_number,
        },
        pypiJob: pypiJob
          ? { name: pypiJob.name, status: pypiJob.status, conclusion: pypiJob.conclusion, htmlUrl: pypiJob.html_url }
          : null,
      };
    } catch (err) {
      return { error: `CD 工作流状态获取失败: ${err.message}` };
    }
  });
}

/**
 * pypistats.org 下载统计（公开免鉴权；数据日粒度、延迟约 1 天，缓存 5 分钟足够）。
 * 分布类端点统一 mirrors=false：剔除 bandersnatch 类全量镜像的同步流量，更接近真实获取行为。
 */
async function fetchStats() {
  return cached('stats', CACHE_TTL.stats, async () => {
    const base = `https://pypistats.org/api/packages/${PYPI_PACKAGE}`;
    const get = (p) => fetchJson(base + p, { timeoutMs: STATS_TIMEOUT_MS });
    const [recent, byPython, bySystem, overall] = await Promise.allSettled([
      get('/recent'),
      get('/python_minor?mirrors=false'),
      get('/system?mirrors=false'),
      get('/overall?period=month'),
    ]);
    if ([recent, byPython, bySystem, overall].every((r) => r.status === 'rejected')) {
      return { error: `下载统计获取失败: ${recent.reason?.message}` };
    }
    return {
      recent: recent.status === 'fulfilled' ? recent.value?.data ?? null : null,
      byPython: byPython.status === 'fulfilled' ? aggregateByCategory(byPython.value?.data) : null,
      bySystem: bySystem.status === 'fulfilled' ? aggregateByCategory(bySystem.value?.data) : null,
      totals: overall.status === 'fulfilled' ? mapOverallTotals(overall.value?.data) : null,
    };
  });
}

// ============================================================================
// 状态聚合
// ============================================================================

function gitOut(args) {
  try {
    return execSync(`git ${args}`, { cwd: ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
}

async function buildStatePayload() {
  const versions = MANIFESTS.map((m) => {
    let version = null;
    try {
      version = readManifestVersion(m);
    } catch {
      version = '读取失败';
    }
    return { file: m.file, version };
  });
  const rootVersion = versions[0]?.version;
  const allConsistent = versions.every((v) => v.version === rootVersion);
  const tags = gitOut('tag -l').split('\n').filter(Boolean).filter((t) => /^v[0-9]/.test(t));
  const latestTag = latestVersionTag(tags);

  const [pypi, ghReleases, workflow, stats] = await Promise.all([
    fetchPypiMeta(),
    fetchGithubReleases(),
    fetchWorkflow(),
    fetchStats(),
  ]);

  const ghLatest = Array.isArray(ghReleases) ? ghReleases.find((r) => !r.draft) ?? ghReleases[0] ?? null : null;
  const alignment = computeAlignment({
    rootVersion: /^\d/.test(rootVersion ?? '') ? rootVersion : null,
    allConsistent,
    latestTag,
    ghReleaseTag: ghLatest?.tag ?? null,
    pypiVersion: pypi.error ? null : pypi.latestVersion,
  });

  let changelogVersions = [];
  try {
    changelogVersions = parseChangelogVersions(fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf-8'));
  } catch {
    changelogVersions = [];
  }

  return {
    repo: REPO_SLUG,
    package: PYPI_PACKAGE,
    rootVersion,
    allConsistent,
    latestTag,
    versions,
    alignment,
    pypi: pypi.error ? { error: pypi.error } : { latestVersion: pypi.latestVersion, releases: pypi.releases },
    workflow,
    githubReleases: Array.isArray(ghReleases) ? ghReleases : { error: ghReleases.error },
    stats,
    changelogVersions,
    job: jobStatus(),
  };
}

// ============================================================================
// 任务调度 / SSE 广播（模式同 release-gui：单任务互斥 + 历史回放）
// ============================================================================

let currentJob = null;
const logHistory = [];
const LOG_HISTORY_LIMIT = 3000;
const sseClients = new Set();

function sseSend(obj) {
  const data = `data: ${JSON.stringify(obj)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(data);
    } catch {
      sseClients.delete(res);
    }
  }
}

function appendLog(stream, text) {
  const entry = { type: 'line', stream, text: stripAnsi(text), ts: Date.now() };
  logHistory.push(entry);
  if (logHistory.length > LOG_HISTORY_LIMIT) logHistory.shift();
  sseSend(entry);
}

function jobStatus() {
  if (!currentJob) return { running: false };
  const { label, startedAt, exitCode, done } = currentJob;
  return { running: !done, label, startedAt, exitCode: done ? exitCode : null, done };
}

function startJob(label, cmd, cwd) {
  if (currentJob && !currentJob.done) return false;
  logHistory.length = 0;

  const isWin = process.platform === 'win32';
  const fullCmd = isWin ? `chcp 65001 >nul & ${cmd}` : cmd;
  const child = spawn(fullCmd, {
    shell: true,
    cwd,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', FORCE_COLOR: '0' },
    detached: !isWin,
  });

  currentJob = { label, cmd, cwd, child, startedAt: Date.now(), exitCode: null, done: false };
  appendLog('info', `▶ ${label}`);
  appendLog('info', `$ ${cmd}   (cwd: ${path.relative(ROOT, cwd) || '.'})`);

  const out = createLineSplitter((line) => appendLog('stdout', line));
  const err = createLineSplitter((line) => appendLog('stderr', line));
  child.stdout.on('data', (b) => out.push(b.toString('utf-8')));
  child.stderr.on('data', (b) => err.push(b.toString('utf-8')));

  child.on('close', (code) => {
    out.flush();
    err.flush();
    currentJob.exitCode = code;
    currentJob.done = true;
    appendLog('info', code === 0 ? `✔ ${label} 完成（exit 0）` : `✘ ${label} 失败（exit ${code}）`);
    sseSend({ type: 'status', job: jobStatus() });
  });

  sseSend({ type: 'status', job: jobStatus() });
  return true;
}

function killCurrentJob() {
  if (!currentJob || currentJob.done) return false;
  const pid = currentJob.child.pid;
  appendLog('info', '⏹ 用户请求终止任务…');
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /T /F /PID ${pid}`, { windowsHide: true, timeout: 5000 });
    } else {
      process.kill(-pid, 'SIGTERM');
    }
  } catch {
    currentJob.child.kill('SIGTERM');
  }
  return true;
}

// ============================================================================
// HTTP 服务
// ============================================================================

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (b) => {
      data += b;
      if (data.length > 64 * 1024) reject(new Error('请求体过大'));
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1`);

  // 状态变更接口只接受本机控制台发起的请求（外源 Origin / DNS rebinding Host 一律拒绝）
  if (req.method === 'POST' && !isLocalBrowserRequest(req.headers, server.address()?.port)) {
    sendJson(res, 403, { ok: false, error: '仅允许本机控制台页面调用（Origin/Host 校验未通过）' });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/') {
    try {
      const html = fs.readFileSync(HTML_PATH);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`缺少页面文件: ${HTML_PATH}`);
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    });
    res.write(`data: ${JSON.stringify({ type: 'history', lines: logHistory })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'status', job: jobStatus() })}\n\n`);
    sseClients.add(res);
    const heartbeat = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        /* 关闭时清理 */
      }
    }, 25000);
    req.on('close', () => {
      clearInterval(heartbeat);
      sseClients.delete(res);
    });
    return;
  }

  try {
    if (req.method === 'GET' && url.pathname === '/api/state') {
      sendJson(res, 200, await buildStatePayload());
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/run') {
      const body = await readJsonBody(req);
      const { label, cmd, cwd } = buildPypiActionCommand(body.action, body.params ?? {});
      if (currentJob && !currentJob.done) {
        sendJson(res, 409, { ok: false, error: `任务进行中: ${currentJob.label}（请先等待完成或终止）` });
        return;
      }
      startJob(label, cmd, cwd);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/kill') {
      sendJson(res, 200, { ok: killCurrentJob() });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'not found' }));
  } catch (err) {
    sendJson(res, 400, { ok: false, error: err.message });
  }
});

// ============================================================================
// 启动
// ============================================================================

/** 退出前显式终止任务子进程（Unix detached 进程组不随主进程死） */
function shutdown(signal) {
  console.log(`\n[pypi-gui] 收到 ${signal}，正在终止运行中的任务…`);
  killCurrentJob();
  for (const res of sseClients) {
    try {
      res.destroy();
    } catch {
      /* 已断开 */
    }
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}

function openBrowser(url) {
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {
    /* 打开失败仅打印 URL */
  }
}

function main() {
  const args = process.argv.slice(2);
  const portIdx = args.indexOf('--port');
  let port = portIdx >= 0 ? Number(args[portIdx + 1]) : DEFAULT_PORT;
  const noOpen = args.includes('--no-open');
  if (!Number.isInteger(port) || port <= 0 || port > 65535) port = DEFAULT_PORT;

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // 端口被占则依次 +1 重试（最多 20 次），与 release-gui 可同时运行互不干扰
  const listen = (p) => {
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE' && p - DEFAULT_PORT < 20) {
        listen(p + 1);
      } else {
        console.error(`[pypi-gui] 监听失败: ${err.message}`);
        process.exit(1);
      }
    });
    server.listen(p, '127.0.0.1', () => {
      const url = `http://127.0.0.1:${p}`;
      console.log(`\n[pypi-gui] Precis PyPI 管理控制台已启动: ${url}`);
      console.log('[pypi-gui] 能力: 版本对齐 / 发布历史 / pypi job 状态 / 下载统计 / 线上包验证');
      console.log('[pypi-gui] Ctrl+C 退出（会先终止运行中的验证任务）\n');
      if (!noOpen) openBrowser(url);
    });
  };
  listen(port);
}

// 直接执行时启动服务；被 import（单元测试）时不启动
if (process.argv[1] && pathToFileURL(process.argv[1]).href === pathToFileURL(SCRIPT_PATH).href) {
  main();
}
