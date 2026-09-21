#!/usr/bin/env node
/**
 * @fileoverview PyPI 已发布包验证 —— 在干净 venv 安装真实 PyPI 上的 precis-cli 并跑冒烟
 *
 * 与 cd.yml 的 pypi job 发布前冒烟同口径（--version 匹配 + demo 项目 8 违规基线 + 退出码 1），
 * 但验证对象是**发布后线上真实产物**（发布前冒烟验证的是本地 dist/ 的 wheel）。
 *
 * 用法:
 *   node scripts/verify-pypi-package.mjs --version <X> [--index-url <URL>] [--python <path>] [--keep]
 *
 * 步骤:
 *   1. 检查 Python 解释器版本满足包的 requires-python（>=3.12,<3.14）
 *   2. 在系统临时目录创建一次性 venv（--keep 保留现场供排查）
 *   3. venv 内 pip install precis-cli==<X>（默认官方源；--index-url 可换镜像）
 *   4. venv 的 precis 入口执行 --version，断言输出含 <X>
 *   5. precis validate demo 项目：断言退出码 1 + JSON 契约（schema_version=1 / is_valid=false / 8 违规）
 *
 * 退出码: 0 全部通过；1 任一步失败（原因已逐行打印）
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isValidSemver } from './release.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');
const DEMO_MANIFEST = path.join(ROOT, 'demo', 'precis-project', 'project.precis.yaml');
/** demo 项目验收基线：恰好 8 处违规（与 cd.yml pypi job 冒烟、MCP 集成测试同口径） */
const EXPECTED_VIOLATIONS = 8;

// ============================================================================
// 纯函数（供 node --test 单元测试）
// ============================================================================

/** --version 输出是否包含期望版本号（CI 冒烟 case 语句的同语义 JS 版） */
export function checkVersionOutput(out, expected) {
  return typeof out === 'string' && typeof expected === 'string' && out.includes(expected);
}

/**
 * validate JSON payload 契约校验：返回 {ok, problems[]}（不抛异常，日志友好）。
 * 与 cd.yml pypi job 冒烟断言完全同口径。
 */
export function checkValidatePayload(payload) {
  const problems = [];
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, problems: ['payload 不是 JSON 对象（输出可能不是合法 JSON 或混入了非 JSON 行）'] };
  }
  if (payload.schema_version !== 1) problems.push(`schema_version 期望 1，实际 ${JSON.stringify(payload.schema_version)}`);
  if (payload.is_valid !== false) problems.push(`is_valid 期望 false（demo 项目必含违规），实际 ${JSON.stringify(payload.is_valid)}`);
  const n = Array.isArray(payload.errors) ? payload.errors.length : null;
  if (n !== EXPECTED_VIOLATIONS) {
    problems.push(`errors 期望 ${EXPECTED_VIOLATIONS} 处违规，实际 ${n === null ? '缺失/非数组' : n}`);
  }
  return { ok: problems.length === 0, problems };
}

/** venv 内 python 解释器路径（win: Scripts/python.exe / unix: bin/python） */
export function venvPython(venvDir, platform = process.platform) {
  return platform === 'win32' ? path.join(venvDir, 'Scripts', 'python.exe') : path.join(venvDir, 'bin', 'python');
}

/** venv 内 precis 命令路径（win: pip 经 distlib 生成 .exe 包装器，可直接 spawn；unix: bin/precis） */
export function venvPrecis(venvDir, platform = process.platform) {
  return platform === 'win32' ? path.join(venvDir, 'Scripts', 'precis.exe') : path.join(venvDir, 'bin', 'precis');
}

/** CLI 参数解析（供测试：形状与缺省值） */
export function parseVerifyArgs(argv) {
  const args = { version: null, indexUrl: null, keep: false, python: process.env.PRECIS_PYTHON || 'python' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--version') args.version = argv[++i];
    else if (a.startsWith('--version=')) args.version = a.slice('--version='.length);
    else if (a === '--index-url') args.indexUrl = argv[++i];
    else if (a.startsWith('--index-url=')) args.indexUrl = a.slice('--index-url='.length);
    else if (a === '--python') args.python = argv[++i];
    else if (a.startsWith('--python=')) args.python = a.slice('--python='.length);
    else if (a === '--keep') args.keep = true;
    else if (a === '-h' || a === '--help') args.help = true;
    else args.unknown = a;
  }
  return args;
}

// ============================================================================
// 子进程辅助（逐行流式打印，供 SSE 转发）
// ============================================================================

function log(text) {
  console.log(text);
}

/** 以参数数组 spawn（不经 shell，路径含空格/特殊字符安全），stdout/stderr 逐行转发 */
function runStream(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd ?? ROOT,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', FORCE_COLOR: '0', NO_COLOR: '1' },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const pump = (stream, buf) => {
      let s = '';
      stream.on('data', (b) => {
        s += b.toString('utf-8');
        let idx;
        while ((idx = s.indexOf('\n')) >= 0) {
          const line = s.slice(0, idx).replace(/\r$/, '');
          s = s.slice(idx + 1);
          if (line) log(`  ${line}`);
        }
      });
      stream.on('end', () => {
        if (s.trim()) log(`  ${s.trim()}`);
      });
    };
    pump(child.stdout, () => {});
    pump(child.stderr, () => {});
    child.stdout.on('data', (b) => (stdout += b.toString('utf-8')));
    child.stderr.on('data', (b) => (stderr += b.toString('utf-8')));
    child.on('error', (err) => resolve({ code: -1, stdout, stderr, spawnError: err.message }));
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

function fail(msg) {
  log(`\n[verify-pypi] ✘ ${msg}`);
  process.exit(1);
}

// ============================================================================
// 主流程
// ============================================================================

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

async function main() {
  const args = parseVerifyArgs(process.argv.slice(2));
  if (args.help || args.unknown) {
    log(`用法: node scripts/verify-pypi-package.mjs --version <X> [--index-url <URL>] [--python <path>] [--keep]`);
    process.exit(args.help ? 0 : 2);
  }
  if (!args.version || !isValidSemver(args.version)) {
    fail(`--version 缺失或非法（需 semver）: ${args.version}`);
  }

  log(`▶ 验证 PyPI 已发布包 precis-cli==${args.version}`);
  log(`  索引源: ${args.indexUrl || 'https://pypi.org/simple（官方）'}`);

  // ---- 1. Python 解释器检查 ----
  const py = detectPython(args.python);
  if (!py) {
    fail(
      `找不到可用的 Python（尝试了 "${args.python}"${process.platform === 'win32' ? ' 和 "py -3"' : ''}）。` +
        ` 请用 --python 指定路径，或设 PRECIS_PYTHON 环境变量`,
    );
  }
  log(`✔ Python ${py.version}（${py.cmd}）`);
  const [maj, min] = py.version.split('.').map(Number);
  const below = maj < 3 || (maj === 3 && min < 12);
  const above = maj > 3 || (maj === 3 && min >= 14);
  if (below || above) {
    fail(
      `Python ${py.version} 不满足包的 requires-python（>=3.12,<3.14）：pip 会拒绝安装。` +
        ` 请用 --python 指定 3.12/3.13 解释器`,
    );
  }

  // ---- 2. 创建一次性 venv ----
  const venvDir = path.join(os.tmpdir(), `precis-pypi-verify-${Date.now()}`);
  log(`▶ 创建临时 venv: ${venvDir}`);
  const mk = await runStream(py.cmd, ['-m', 'venv', venvDir]);
  if (mk.code !== 0) fail(`venv 创建失败（exit ${mk.code}）`);
  const vpy = venvPython(venvDir);
  const vprecis = venvPrecis(venvDir);
  if (!fs.existsSync(vpy)) fail(`venv 内未找到 python: ${vpy}`);

  // ---- 3. 安装真实 PyPI 包 ----
  const installArgs = ['-m', 'pip', 'install', '--disable-pip-version-check', `precis-cli==${args.version}`];
  if (args.indexUrl) installArgs.push('--index-url', args.indexUrl);
  log(`▶ pip install precis-cli==${args.version}（重依赖较多，首次可能要几分钟）`);
  const inst = await runStream(vpy, installArgs);
  if (inst.code !== 0) fail(`安装失败（exit ${inst.code}）——版本不存在？网络问题？镜像源未同步？`);
  if (!fs.existsSync(vprecis)) fail(`安装成功但未找到 precis 命令: ${vprecis}`);

  // ---- 4. --version 契约 ----
  log(`▶ precis --version`);
  const ver = await runStream(vprecis, ['--version']);
  if (ver.code !== 0) fail(`precis --version 退出码 ${ver.code}`);
  if (!checkVersionOutput(ver.stdout, args.version)) {
    fail(`--version 输出不包含 ${args.version}: ${JSON.stringify((ver.stdout || '').trim())}`);
  }
  log(`✔ 版本号匹配`);

  // ---- 5. demo 项目冒烟（8 违规基线 + 退出码 1） ----
  log(`▶ precis validate demo 项目（期望发现 8 处违规、退出码 1）`);
  const val = await runStream(vprecis, ['validate', '--manifest', DEMO_MANIFEST, '--format', 'json']);
  if (val.code !== 1) {
    fail(`demo 校验期望退出码 1（发现违规），实际 ${val.code}——线上包行为与发布基线不符`);
  }
  let payload;
  try {
    // rich 可能输出非 JSON 装饰行，容错提取首个 { 到最后一个 } 之间的内容
    const raw = val.stdout;
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    payload = JSON.parse(start >= 0 && end > start ? raw.slice(start, end + 1) : raw);
  } catch (err) {
    fail(`validate 输出不是合法 JSON: ${err.message}`);
  }
  const check = checkValidatePayload(payload);
  if (!check.ok) {
    fail(`validate JSON 契约不符:\n  - ${check.problems.join('\n  - ')}`);
  }
  log(`✔ 8 违规基线复现（schema_version=1 / is_valid=false / errors=${EXPECTED_VIOLATIONS}）`);

  // ---- 清理 ----
  if (args.keep) {
    log(`\n✔ 验证全部通过（--keep：venv 保留在 ${venvDir}）`);
  } else {
    fs.rmSync(venvDir, { recursive: true, force: true, maxRetries: 3 });
    log(`\n✔ 验证全部通过（venv 已清理）`);
  }
  log(`线上包 precis-cli==${args.version} 安装可用、行为与发布基线一致`);
}

// 直接执行时运行；被 import（单元测试）时不执行
if (process.argv[1] && pathToFileURL(process.argv[1]).href === pathToFileURL(SCRIPT_PATH).href) {
  main().catch((err) => {
    console.error(`[verify-pypi] 未预期失败: ${err?.stack || err}`);
    process.exit(1);
  });
}
