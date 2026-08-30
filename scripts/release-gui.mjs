#!/usr/bin/env node
/**
 * @fileoverview Precis 发布控制台 —— 打包 / 发布 / 更新演练 / 线上状态 的本地轻量 GUI
 *
 * 设计目标："无脑"操作——每个动作一个按钮 + 一个实时日志窗，版本号全部预填。
 * 技术形态：零依赖（仅 Node 内置模块）HTTP 服务 + 单页 HTML（scripts/release-gui.html），
 *           子进程 stdout/stderr 经 SSE 流式推送浏览器，无任何前端构建步骤。
 *
 * 用法: npm run release:gui [-- --port 17888 --no-open]
 *
 * 路由:
 *   GET  /                    控制台页面
 *   GET  /api/state           聚合状态（六处 manifest 版本 / 最新 tag / 构建产物 / GitHub Release）
 *   GET  /api/events          SSE 日志与任务状态流（含历史回放）
 *   POST /api/run             执行动作（build / release-dry / release / drill-lite / drill-full /
 *                             verify-release / check-manifests）——同一时刻只允许一个任务
 *   POST /api/kill            终止当前任务（进程树）
 *   POST /api/service         启停 serve-updates 本地更新源（长驻服务，与任务并行）
 *   POST /api/open            打开本地目录（release / local-updates）
 *
 * 安全约束:
 *   - 只绑定 127.0.0.1，不对外暴露
 *   - 客户端只能触发固定动作枚举；所有进入 shell 的用户输入（版本号/tag/端口）
 *     先经白名单正则校验（validateVersionish / validateTag / validatePort），
 *     杜绝命令注入
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_PATH);
const ROOT = path.resolve(SCRIPT_DIR, '..');
const ELECTRON_DIR = path.join(ROOT, 'electron');
const HTML_PATH = path.join(SCRIPT_DIR, 'release-gui.html');
const REPO_SLUG = 'AirSaiga/Precis';
const DEFAULT_PORT = 17888;

// 复用 release.mjs / verify-release-assets.mjs 的纯函数（单一实现，避免副本漂移）
const { MANIFESTS, readManifestVersion, bumpVersion } = await import('./release.mjs');
const { parseLatestYml } = await import('./verify-release-assets.mjs');

// ============================================================================
// 输入校验与命令拼装（纯函数，供 node --test 单测）
// ============================================================================

/** 版本号白名单：字母数字起头，仅允许 . + - 连接（覆盖 semver 全集），拒绝任何 shell 元字符 */
export function validateVersionish(v) {
  return typeof v === 'string' && /^[0-9A-Za-z][0-9A-Za-z.+-]{0,31}$/.test(v);
}

/** tag 白名单：v 前缀 + 版本号字符集 */
export function validateTag(v) {
  return typeof v === 'string' && /^v[0-9A-Za-z.+-]{1,31}$/.test(v);
}

/** 端口白名单：2-5 位数字且在合法区间 */
export function validatePort(p) {
  return /^[0-9]{2,5}$/.test(String(p)) && Number(p) > 0 && Number(p) < 65536;
}

function requireVersion(v, field = 'version') {
  if (!validateVersionish(v)) throw new Error(`${field} 非法（仅允许 semver 字符）: ${v}`);
  return v;
}

/**
 * 剥离子进程输出中的 ANSI 转义序列与残留控制字符（npm/lint-staged 等工具在管道下
 * 仍会输出颜色码，SSE 原样转发会在 HTML 日志窗里显示成 "[33m..." 乱码）。
 */
const ANSI_RE = /\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
const C0_CTRL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;
export function stripAnsi(text) {
  return String(text).replace(ANSI_RE, '').replace(C0_CTRL_RE, '');
}

/**
 * 把动作 + 参数拼装为受控 shell 命令。
 * @returns {{ label: string, cmd: string, cwd: string, platformCmd?: boolean }}
 * @throws 参数非法时抛错（未知动作 / 校验失败）
 */
export function buildActionCommand(action, params = {}, platform = process.platform) {
  const v = () => requireVersion(params.version);
  switch (action) {
    case 'build':
      return {
        label: platform === 'win32' ? '制作安装包（Windows）' : '制作安装包（macOS）',
        cmd: platform === 'win32' ? 'npm run dist:win' : 'npm run dist:mac',
        cwd: ROOT,
      };
    case 'release-dry':
      return { label: `预览发布改动 ${v()}`, cmd: `node scripts/release.mjs ${params.version} --dry-run`, cwd: ROOT };
    case 'release': {
      const noPush = params.noPush === true ? ' --no-push' : '';
      return {
        label: `正式发布 ${v()}${noPush ? '（暂不上传）' : ''}`,
        cmd: `node scripts/release.mjs ${params.version}${noPush}`,
        cwd: ROOT,
      };
    }
    case 'drill-lite':
      return {
        label: `准备模拟更新 ${v()}`,
        cmd: `node scripts/update-drill.mjs lite --version ${params.version}`,
        cwd: ELECTRON_DIR,
      };
    case 'drill-full': {
      const base = requireVersion(params.base, 'base');
      const next = requireVersion(params.next, 'next');
      return {
        label: `制作新旧安装包 ${base} → ${next}`,
        cmd: `node scripts/update-drill.mjs full --base ${base} --next ${next}`,
        cwd: ELECTRON_DIR,
      };
    }
    case 'verify-release': {
      const tag = params.tag;
      if (!validateTag(tag)) throw new Error(`tag 非法: ${tag}`);
      const version = requireVersion(params.version);
      return {
        label: `检查线上安装包 ${tag}`,
        cmd: `node scripts/verify-release-assets.mjs --repo ${REPO_SLUG} --tag ${tag} --version ${version}`,
        cwd: ROOT,
      };
    }
    case 'check-manifests': {
      const version = requireVersion(params.version);
      return { label: `检查版本号对齐 ${version}`, cmd: `node scripts/release.mjs check ${version}`, cwd: ROOT };
    }
    default:
      throw new Error(`未知动作: ${action}`);
  }
}

/**
 * 按行切分器：把子进程 chunk 流切成完整行回调（处理跨 chunk 断行与 CRLF）。
 * @returns {{ push(chunk: string): void, flush(): void }}
 */
export function createLineSplitter(onLine) {
  let buffer = '';
  return {
    push(chunk) {
      buffer += chunk;
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).replace(/\r$/, '');
        buffer = buffer.slice(idx + 1);
        if (line) onLine(line);
      }
    },
    flush() {
      if (buffer) {
        const line = buffer.replace(/\r$/, '');
        buffer = '';
        if (line) onLine(line);
      }
    },
  };
}

// ============================================================================
// 任务调度 / SSE 广播
// ============================================================================

/** 当前任务（同一时刻只允许一个；null = 空闲） */
let currentJob = null;
/** 日志历史环形缓冲（SSE 重连/页面刷新后回放） */
const logHistory = [];
const LOG_HISTORY_LIMIT = 3000;
/** SSE 客户端集合 */
const sseClients = new Set();
/** serve-updates 长驻服务 */
let serveChild = null;
let servePort = null;

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

/** 启动一个受控任务（忙时返回 false） */
function startJob(label, cmd, cwd) {
  if (currentJob && !currentJob.done) return false;
  logHistory.length = 0;

  const isWin = process.platform === 'win32';
  // Windows: 先 chcp 65001 让 powershell/npm 子进程输出 UTF-8，避免中文日志乱码
  const fullCmd = isWin ? `chcp 65001 >nul & ${cmd}` : cmd;
  const child = spawn(fullCmd, {
    shell: true,
    cwd,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', FORCE_COLOR: '0' },
    detached: !isWin, // Unix 上建进程组便于整组终止（对齐 pythonProcess.ts 模式）
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
// 状态聚合
// ============================================================================

function gitOut(args) {
  try {
    return execSync(`git ${args}`, { cwd: ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
}

function collectBuildArtifacts() {
  const dir = path.join(ELECTRON_DIR, 'release');
  if (!fs.existsSync(dir)) return { dir, files: [], latestYml: null };
  const files = fs
    .readdirSync(dir)
    .filter((f) => fs.statSync(path.join(dir, f)).isFile())
    .map((f) => {
      const st = fs.statSync(path.join(dir, f));
      return { name: f, size: st.size, mtime: st.mtime.toISOString() };
    })
    .sort((a, b) => b.mtime.localeCompare(a.mtime))
    .slice(0, 12);
  let latestYml = null;
  const ymlPath = path.join(dir, 'latest.yml');
  if (fs.existsSync(ymlPath)) {
    try {
      latestYml = parseLatestYml(fs.readFileSync(ymlPath, 'utf-8'));
    } catch {
      latestYml = null;
    }
  }
  return { dir, files, latestYml };
}

async function fetchGithubReleases() {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO_SLUG}/releases?per_page=5`, {
      headers: { 'User-Agent': 'precis-release-gui', Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { error: `GitHub API HTTP ${res.status}` };
    const list = await res.json();
    return {
      releases: list.map((r) => ({
        tag: r.tag_name,
        name: r.name,
        draft: r.draft,
        prerelease: r.prerelease,
        publishedAt: r.published_at,
        assets: (r.assets ?? []).map((a) => ({ name: a.name, size: a.size })),
      })),
    };
  } catch (err) {
    return { error: err.message };
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
  const tags = gitOut('tag -l').split('\n').filter(Boolean).filter((t) => /^v[0-9]/.test(t));
  const latestTag = tags.length > 0 ? tags[tags.length - 1] : null;
  let suggestedNext = null;
  if (rootVersion && /^\d/.test(rootVersion)) {
    try {
      suggestedNext = bumpVersion(rootVersion, 'patch');
    } catch {
      suggestedNext = null;
    }
  }
  const allConsistent = versions.every((v) => v.version === rootVersion);
  return {
    repo: REPO_SLUG,
    platform: process.platform === 'win32' ? 'Windows NSIS' : process.platform === 'darwin' ? 'macOS DMG' : process.platform,
    versions,
    rootVersion,
    allConsistent,
    latestTag,
    suggestedNext,
    branch: gitOut('rev-parse --abbrev-ref HEAD') || null,
    buildArtifacts: collectBuildArtifacts(),
    github: await fetchGithubReleases(),
    serveUpdates: serveChild ? { running: true, port: servePort, url: `http://localhost:${servePort}` } : { running: false },
    job: jobStatus(),
  };
}

// ============================================================================
// serve-updates 长驻服务管理
// ============================================================================

function startServeUpdates(port) {
  if (serveChild) return { ok: true, alreadyRunning: true, port: servePort };
  if (!validatePort(port)) throw new Error(`端口非法: ${port}`);
  servePort = String(port);
  const child = spawn(`node scripts/serve-updates.js ${servePort}`, {
    shell: true,
    cwd: ELECTRON_DIR,
    stdio: 'ignore',
    detached: false,
  });
  serveChild = child;
  child.on('close', () => {
    serveChild = null;
    sseSend({ type: 'status' });
  });
  sseSend({ type: 'status' });
  return { ok: true, port: servePort };
}

function stopServeUpdates() {
  if (!serveChild) return { ok: true, alreadyStopped: true };
  const pid = serveChild.pid;
  try {
    if (process.platform === 'win32' && pid) {
      execSync(`taskkill /T /F /PID ${pid}`, { windowsHide: true, timeout: 5000 });
    } else {
      serveChild.kill('SIGTERM');
    }
  } catch {
    serveChild.kill('SIGTERM');
  }
  return { ok: true };
}

// ============================================================================
// HTTP 服务
// ============================================================================

function openInFileExplorer(target) {
  const dir =
    target === 'release'
      ? path.join(ELECTRON_DIR, 'release')
      : target === 'local-updates'
        ? path.join(ELECTRON_DIR, 'local-updates')
        : null;
  if (!dir) throw new Error(`未知目录: ${target}`);
  fs.mkdirSync(dir, { recursive: true });
  const cmd = process.platform === 'win32' ? 'explorer' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  try {
    spawn(cmd, [dir], { detached: true, stdio: 'ignore' }).unref();
  } catch {
    // 打开失败不阻断，路径已在页面展示
  }
  return { ok: true, dir };
}

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

  // ---- 页面 ----
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

  // ---- SSE 日志流 ----
  if (req.method === 'GET' && url.pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    });
    // 历史回放（页面刷新不丢日志）
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
    // ---- 聚合状态 ----
    if (req.method === 'GET' && url.pathname === '/api/state') {
      sendJson(res, 200, await buildStatePayload());
      return;
    }

    // ---- 执行动作 ----
    if (req.method === 'POST' && url.pathname === '/api/run') {
      const body = await readJsonBody(req);
      const { label, cmd, cwd } = buildActionCommand(body.action, body.params ?? {}, process.platform);
      if (currentJob && !currentJob.done) {
        sendJson(res, 409, { ok: false, error: `任务进行中: ${currentJob.label}（请先等待完成或终止）` });
        return;
      }
      startJob(label, cmd, cwd);
      sendJson(res, 200, { ok: true });
      return;
    }

    // ---- 终止任务 ----
    if (req.method === 'POST' && url.pathname === '/api/kill') {
      const killed = killCurrentJob();
      sendJson(res, 200, { ok: killed });
      return;
    }

    // ---- serve-updates 服务 ----
    if (req.method === 'POST' && url.pathname === '/api/service') {
      const body = await readJsonBody(req);
      if (body.op === 'start') sendJson(res, 200, startServeUpdates(body.port ?? '8080'));
      else if (body.op === 'stop') sendJson(res, 200, stopServeUpdates());
      else sendJson(res, 400, { ok: false, error: `未知 op: ${body.op}` });
      return;
    }

    // ---- 打开目录 ----
    if (req.method === 'POST' && url.pathname === '/api/open') {
      const body = await readJsonBody(req);
      if (!['release', 'local-updates'].includes(body.target)) {
        sendJson(res, 400, { ok: false, error: 'target 仅允许 release / local-updates' });
        return;
      }
      sendJson(res, 200, openInFileExplorer(body.target));
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
    // 打开失败仅打印 URL
  }
}

function main() {
  const args = process.argv.slice(2);
  const portIdx = args.indexOf('--port');
  let port = portIdx >= 0 ? Number(args[portIdx + 1]) : DEFAULT_PORT;
  const noOpen = args.includes('--no-open');
  if (!Number.isInteger(port) || port <= 0 || port > 65535) port = DEFAULT_PORT;

  // 端口被占则依次 +1 重试（最多 20 次），免去手动选端口
  const listen = (p) => {
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE' && p - DEFAULT_PORT < 20) {
        listen(p + 1);
      } else {
        console.error(`[release-gui] 监听失败: ${err.message}`);
        process.exit(1);
      }
    });
    server.listen(p, '127.0.0.1', () => {
      const url = `http://127.0.0.1:${p}`;
      console.log(`\n[release-gui] Precis 发布控制台已启动: ${url}`);
      console.log('[release-gui] 动作: 打包 / 发布(dry-run+正式) / 更新演练(lite|full) / 线上状态校验');
      console.log('[release-gui] Ctrl+C 退出（运行中的子进程会随服务终止）\n');
      if (!noOpen) openBrowser(url);
    });
  };
  listen(port);
}

// 直接执行时启动服务；被 import（单元测试）时不启动
if (process.argv[1] && pathToFileURL(process.argv[1]).href === pathToFileURL(SCRIPT_PATH).href) {
  main();
}
