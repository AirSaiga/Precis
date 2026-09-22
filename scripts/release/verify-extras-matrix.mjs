#!/usr/bin/env node
/**
 * @fileoverview precis-cli extras 安装形态矩阵验证 —— 5 种安装形态各自在一次性 venv 中安装并断言行为
 *
 * 形态与断言（每形态独立 venv，真隔离，互不污染）:
 *   bare  : precis --version ✓；precis-mcp 退出码 1 + "precis-cli[mcp]" 指引（H15）；
 *           precis-start 退出码 1 + "precis-cli[api]" 指引；precis ai 输出 "[ai]" 门控指引
 *   api   : venv 内 import uvicorn ✓ 且 _api_dependencies_available() 为 True
 *   ai    : venv 内 import openai ✓ 且 ai_dependencies_available() 为 True
 *   mcp   : venv 内 import mcp ✓ 且 precis-mcp 完成 MCP initialize 握手（返回 serverInfo.name=precis）
 *   full  : 上述 api+ai+mcp 全部正向断言（不再出现任何安装指引）
 *
 * 数据源: 默认本地构建 wheel（backend 下 python -m build --wheel，发布前可跑）；
 *         --pypi 从官方源装最新版（发布后巡检）。
 *
 * 用法:
 *   node scripts/release/verify-extras-matrix.mjs [--pypi] [--keep] [--python <path>] [--variants a,b,c]
 *
 * 退出码: 0 全部通过；1 任一形态失败（逐项打印原因）
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..', '..');
const BACKEND = path.join(ROOT, 'backend');

// ============================================================================
// 纯函数（供 node --test 单元测试）
// ============================================================================

/** 安装形态定义表：extras 后缀 + 该形态的断言开关（顺序即执行顺序） */
export const VARIANTS = [
  { name: 'bare', extras: '', checks: { version: true, mcpGuidance: true, apiGuidance: true, aiGuidance: true } },
  { name: 'api', extras: 'api', checks: { version: true, apiAvailable: true } },
  { name: 'ai', extras: 'ai', checks: { version: true, aiAvailable: true } },
  { name: 'mcp', extras: 'mcp', checks: { version: true, mcpAvailable: true, mcpHandshake: true } },
  { name: 'full', extras: 'full', checks: { version: true, apiAvailable: true, aiAvailable: true, mcpAvailable: true, mcpHandshake: true } },
];

/** pip install 目标串：本地 wheel 路径（或包名）+ extras 后缀 */
export function installTarget({ wheelPath, usePyPI, extras }) {
  const base = usePyPI ? 'precis-cli' : wheelPath;
  if (!base) throw new Error('wheelPath is required when not using PyPI');
  return extras ? `${base}[${extras}]` : base;
}

/** --version 输出是否包含期望版本号 */
export function checkVersionOutput(out, expected) {
  return typeof out === 'string' && typeof expected === 'string' && out.includes(expected);
}

/** 裸装指引断言：退出码 1 且输出含 extras 安装指引串 */
export function checkGuidance({ code, out, hint }) {
  return code === 1 && typeof out === 'string' && out.includes(hint);
}

/** MCP initialize 握手响应是否合法（jsonrpc result.serverInfo.name === 'precis'） */
export function checkMcpHandshake(message) {
  if (!message || message.jsonrpc !== '2.0' || message.id !== 1) return false;
  const info = message.result && message.result.serverInfo;
  return !!(info && info.name === 'precis');
}

/** CLI 参数解析（供测试：形状与缺省值） */
export function parseArgs(argv) {
  const args = { pypi: false, keep: false, python: process.env.PRECIS_PYTHON || 'python', variants: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--pypi') args.pypi = true;
    else if (a === '--keep') args.keep = true;
    else if (a === '--python') args.python = argv[++i];
    else if (a.startsWith('--python=')) args.python = a.slice('--python='.length);
    else if (a === '--variants') args.variants = argv[++i];
    else if (a.startsWith('--variants=')) args.variants = a.slice('--variants='.length);
    else if (a === '-h' || a === '--help') args.help = true;
    else args.unknown = a;
  }
  return args;
}

/** --variants 逗号清单解析为受支持的形态名列表（供测试） */
export function selectVariants(spec) {
  if (!spec) return VARIANTS.map((v) => v.name);
  const wanted = spec.split(',').map((s) => s.trim()).filter(Boolean);
  const known = new Set(VARIANTS.map((v) => v.name));
  const unknown = wanted.filter((w) => !known.has(w));
  if (unknown.length) throw new Error(`未知形态: ${unknown.join(', ')}（支持: ${[...known].join(', ')}）`);
  return wanted;
}

/** venv 内 python 解释器路径（win: Scripts/python.exe / unix: bin/python） */
export function venvPython(venvDir, platform = process.platform) {
  return platform === 'win32' ? path.join(venvDir, 'Scripts', 'python.exe') : path.join(venvDir, 'bin', 'python');
}

/** venv 内命令入口目录（win: Scripts / unix: bin） */
export function venvBin(venvDir, platform = process.platform) {
  return platform === 'win32' ? path.join(venvDir, 'Scripts') : path.join(venvDir, 'bin');
}

// ============================================================================
// 子进程辅助
// ============================================================================

function log(text) {
  console.log(text);
}

/** 静默跑命令，收集 stdout/stderr（不出字，只回结果） */
function runQuiet(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd ?? ROOT,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', NO_COLOR: '1', FORCE_COLOR: '0' },
      windowsHide: true,
      timeout: opts.timeout ?? 120_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => (stdout += b.toString('utf-8')));
    child.stderr.on('data', (b) => (stderr += b.toString('utf-8')));
    child.on('error', (err) => resolve({ code: -1, stdout, stderr, spawnError: err.message }));
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

/** 探测 python 主次版本（py launcher 回退仅 Windows） */
function detectPython(pythonCmd) {
  const tryCmd = (cmd) => {
    const r = spawnSync(cmd, ['-c', 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")'], {
      encoding: 'utf-8',
      windowsHide: true,
      timeout: 15000,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
    const v = (r.stdout || '').trim();
    return /^\d+\.\d+$/.test(v) ? { cmd, version: v } : null;
  };
  return tryCmd(pythonCmd) ?? (process.platform === 'win32' ? tryCmd('py -3') : null);
}

/** 本地构建 backend wheel，返回 wheel 绝对路径 */
async function buildWheel(pyCmd) {
  log('▶ 构建本地 wheel（backend，python -m build --wheel --outdir <tmp>）');
  const outDir = path.join(os.tmpdir(), `precis-extras-wheel-${Date.now()}`);
  const r = await runQuiet(pyCmd, ['-m', 'build', '--wheel', '--outdir', outDir], {
    cwd: BACKEND,
    timeout: 600_000,
  });
  if (r.code !== 0) {
    log(r.stdout);
    log(r.stderr);
    throw new Error(`wheel 构建失败（exit ${r.code}）`);
  }
  const wheels = fs.readdirSync(outDir).filter((f) => f.endsWith('.whl'));
  if (wheels.length !== 1) throw new Error(`期望恰好 1 个 wheel，实际 ${wheels.length}: ${wheels.join(', ')}`);
  const wheelPath = path.join(outDir, wheels[0]);
  // wheel 文件名形如 precis_cli-0.1.6-py3-none-any.whl → 提取版本
  const m = wheels[0].match(/^precis_cli-(\d+\.\d+\.\d+(?:\.\w+)?)[:-]/);
  return { wheelPath, version: m ? m[1] : null };
}

/** 在 venv 内跑一个 python -c 断言片段，返回 {ok, detail} */
async function pythonCheck(vpy, code) {
  const r = await runQuiet(vpy, ['-c', code]);
  return { ok: r.code === 0 && r.stdout.trim() === 'OK', detail: (r.stdout + r.stderr).trim().slice(0, 300) };
}

/** MCP stdio 握手：spawn precis-mcp，发 initialize + initialized 通知，收同 id 响应 */
function mcpHandshake(mcpCmd, cwd) {
  return new Promise((resolve) => {
    const child = spawn(mcpCmd, [], {
      cwd,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', NO_COLOR: '1' },
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let buf = '';
    const timer = setTimeout(() => {
      child.kill();
      resolve(null);
    }, 30_000);
    child.stdout.on('data', (b) => {
      buf += b.toString('utf-8');
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id === 1) {
            clearTimeout(timer);
            child.stdin.end();
            child.kill();
            resolve(msg);
            return;
          }
        } catch {
          /* 非 JSON 行（日志噪声）跳过 */
        }
      }
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'extras-matrix', version: '0.0.1' } } }) + '\n');
  });
}

// ============================================================================
// 单形态执行
// ============================================================================

async function runVariant({ variant, venvDir, version, usePyPI, wheelPath }) {
  const problems = [];
  const vpy = venvPython(venvDir);
  const bin = venvBin(venvDir);
  const precis = path.join(bin, process.platform === 'win32' ? 'precis.exe' : 'precis');
  const precisMcp = path.join(bin, process.platform === 'win32' ? 'precis-mcp.exe' : 'precis-mcp');
  const precisStart = path.join(bin, process.platform === 'win32' ? 'precis-start.exe' : 'precis-start');

  const target = installTarget({ wheelPath, usePyPI, extras: variant.extras });
  log(`  ▶ pip install ${variant.extras ? `'${target}'` : target}`);
  const inst = await runQuiet(vpy, ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', target], {
    timeout: 600_000,
  });
  if (inst.code !== 0) {
    log(inst.stdout.split('\n').slice(-5).join('\n'));
    log(inst.stderr.split('\n').slice(-5).join('\n'));
    return { variant: variant.name, problems: [`pip install 失败（exit ${inst.code}）`] };
  }

  // version：--version 输出版本号（--pypi 模式 version 为 null 时只要求输出 "precis "前缀）
  if (variant.checks.version) {
    const r = await runQuiet(precis, ['--version']);
    const ok = version ? checkVersionOutput(r.stdout, version) : /^precis\s/i.test(r.stdout.trim());
    if (!ok) problems.push(`precis --version 异常（exit ${r.code}）: ${(r.stdout + r.stderr).trim().slice(0, 120)}`);
  }

  // 裸装负向断言：缺 extra 的入口给安装指引（H15 / ai 门控），退出码 1
  if (variant.checks.mcpGuidance) {
    const r = await runQuiet(precisMcp, []);
    if (!checkGuidance({ code: r.code, out: r.stdout + r.stderr, hint: 'precis-cli[mcp]' })) {
      problems.push(`precis-mcp 裸装应退出码 1 + [mcp] 指引，实际 exit ${r.code}: ${(r.stdout + r.stderr).trim().slice(0, 120)}`);
    }
  }
  if (variant.checks.apiGuidance) {
    const r = await runQuiet(precisStart, ['--work-dir', os.tmpdir(), '--no-browser']);
    if (!checkGuidance({ code: r.code, out: r.stdout + r.stderr, hint: 'precis-cli[api]' })) {
      problems.push(`precis-start 裸装应退出码 1 + [api] 指引，实际 exit ${r.code}: ${(r.stdout + r.stderr).trim().slice(0, 120)}`);
    }
  }
  if (variant.checks.aiGuidance) {
    const r = await runQuiet(precis, ['ai']);
    const out = r.stdout + r.stderr;
    if (!(out.includes('precis-cli[ai]') || out.includes('pip install'))) {
      problems.push(`precis ai 裸装应输出 [ai] 安装指引，实际: ${out.trim().slice(0, 120)}`);
    }
  }

  // 正向可用性断言：import + 探测函数
  if (variant.checks.apiAvailable) {
    const c = await pythonCheck(vpy, 'import uvicorn, fastapi\nfrom app.cli.start import _api_dependencies_available\nprint("OK" if _api_dependencies_available() else "NG")');
    if (!c.ok) problems.push(`api 依赖探测失败: ${c.detail}`);
  }
  if (variant.checks.aiAvailable) {
    const c = await pythonCheck(vpy, 'import openai\nfrom app.cli.shell.commands.ai import ai_dependencies_available\nprint("OK" if ai_dependencies_available() else "NG")');
    if (!c.ok) problems.push(`ai 依赖探测失败: ${c.detail}`);
  }
  if (variant.checks.mcpAvailable) {
    const c = await pythonCheck(vpy, 'import mcp\nprint("OK")');
    if (!c.ok) problems.push(`mcp SDK 导入失败: ${c.detail}`);
  }

  // MCP 真握手（cwd=仓库根：路径白名单根覆盖 demo 项目，但装的是 venv 里的包）
  if (variant.checks.mcpHandshake) {
    const msg = await mcpHandshake(precisMcp, ROOT);
    if (!checkMcpHandshake(msg)) {
      problems.push(`precis-mcp initialize 握手失败: ${JSON.stringify(msg).slice(0, 150)}`);
    }
  }

  return { variant: variant.name, problems };
}

// ============================================================================
// 主流程
// ============================================================================

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.unknown) {
    log(`用法: node scripts/release/verify-extras-matrix.mjs [--pypi] [--keep] [--python <path>] [--variants bare,api,ai,mcp,full]`);
    process.exit(args.help ? 0 : 2);
  }
  let variantNames;
  try {
    variantNames = selectVariants(args.variants);
  } catch (e) {
    log(`✘ ${e.message}`);
    process.exit(2);
  }

  const py = detectPython(args.python);
  if (!py) {
    log(`✘ 找不到可用的 Python（尝试了 "${args.python}"${process.platform === 'win32' ? ' 和 "py -3"' : ''}）。请用 --python 指定 3.12/3.13 解释器`);
    process.exit(1);
  }
  log(`✔ Python ${py.version}（${py.cmd}）`);

  let wheelPath = null;
  let version = null;
  if (args.pypi) {
    log('▶ 数据源: PyPI 官方源最新版（发布后巡检口径）');
  } else {
    const built = await buildWheel(py.cmd);
    wheelPath = built.wheelPath;
    version = built.version;
    log(`✔ 本地 wheel: ${path.basename(wheelPath)}${version ? `（版本 ${version}）` : ''}`);
  }

  const workRoot = path.join(os.tmpdir(), `precis-extras-matrix-${Date.now()}`);
  fs.mkdirSync(workRoot, { recursive: true });
  const results = [];
  const selected = VARIANTS.filter((v) => variantNames.includes(v.name));

  for (const variant of selected) {
    log(`\n▶ 形态 [${variant.name}]`);
    const venvDir = path.join(workRoot, `venv-${variant.name}`);
    const mk = await runQuiet(py.cmd, ['-m', 'venv', venvDir], { timeout: 300_000 });
    if (mk.code !== 0) {
      results.push({ variant: variant.name, problems: [`venv 创建失败（exit ${mk.code}）`] });
      continue;
    }
    const result = await runVariant({ variant, venvDir, version, usePyPI: args.pypi, wheelPath });
    if (result.problems.length === 0) log(`  ✔ PASS`);
    else result.problems.forEach((p) => log(`  ✘ ${p}`));
    results.push(result);
  }

  if (!args.keep) {
    fs.rmSync(workRoot, { recursive: true, force: true });
    if (!args.pypi && wheelPath) fs.rmSync(path.dirname(wheelPath), { recursive: true, force: true });
  } else {
    log(`\n[--keep] 现场保留: ${workRoot}`);
  }

  const failed = results.filter((r) => r.problems.length > 0);
  log(`\n===== 汇总: ${results.length - failed.length}/${results.length} 形态通过 =====`);
  results.forEach((r) => log(`  ${r.problems.length === 0 ? '✔' : '✘'} ${r.variant}${r.problems.length ? `（${r.problems.length} 项失败）` : ''}`));
  process.exit(failed.length ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  main().catch((e) => {
    log(`✘ ${e.stack || e.message}`);
    process.exit(1);
  });
}
