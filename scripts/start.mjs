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
 * @fileoverview Precis 跨平台统一启动入口 —— 语义化 target 按 process.platform 分发到既有平台脚本
 *
 * 用法:
 *   node scripts/start.mjs <target>    （或 npm run start:<target>）
 *
 * 分发目标: Windows → scripts/windows/*.bat；macOS/Linux → scripts/mac/*.sh（.bat/.sh 本身不改）。
 * release-gui / pypi-gui 不经本入口 —— 已有 npm run release:gui / pypi:gui 的 node 直跑入口，
 * scripts/{windows,mac} 下的对应脚本仅作双击便利入口保留。
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');

// ============================================================================
// 纯函数（供 node --test 单元测试）
// ============================================================================

/** 语义化 target 定义表：描述 + 两平台脚本（仓库相对路径）。新增 target 在此登记。 */
export const START_TARGETS = {
  dev: {
    description: '开发模式: 后端 + Vite 热重载 + Electron',
    win: 'scripts/windows/start-dev.bat',
    mac: 'scripts/mac/start-dev.sh',
  },
  prod: {
    description: '标准模式: Electron 自行拉起后端, 加载已构建静态前端',
    win: 'scripts/windows/start.bat',
    mac: 'scripts/mac/start.sh',
  },
  backend: {
    description: '仅后端 FastAPI(热重载, 端口动态分配)',
    win: 'scripts/windows/start-backend.bat',
    mac: 'scripts/mac/start-backend.sh',
  },
  frontend: {
    description: '仅前端 Vite 开发服务器(端口 5173)',
    win: 'scripts/windows/start-frontend.bat',
    mac: 'scripts/mac/start-frontend.sh',
  },
  electron: {
    description: '仅 Electron 桌面壳(需前后端已启动)',
    win: 'scripts/windows/start-electron.bat',
    mac: 'scripts/mac/start-electron.sh',
  },
  cli: {
    description: '交互式 Python CLI',
    win: 'scripts/windows/start-cli.bat',
    mac: 'scripts/mac/start-cli.sh',
  },
  tui: {
    description: 'Rust TUI 终端界面',
    win: 'scripts/windows/start-tui-rust.bat',
    mac: 'scripts/mac/start-tui-rust.sh',
  },
};

/** 旧 npm 别名过渡映射（electron 即 desktop；start:tui-rust → start:tui） */
export const TARGET_ALIASES = {
  desktop: 'electron',
  'tui-rust': 'tui',
};

/** target 归一（应用别名表）；未知或非字符串返回 null */
export function canonicalTarget(target) {
  if (typeof target !== 'string') return null;
  if (Object.hasOwn(START_TARGETS, target)) return target;
  const alias = TARGET_ALIASES[target];
  return alias && Object.hasOwn(START_TARGETS, alias) ? alias : null;
}

/** 平台归一: win32 → 'win'，其余（darwin/linux）→ 'mac'（Mac 脚本同样适用于 Linux） */
export function platformKey(platform = process.platform) {
  return platform === 'win32' ? 'win' : 'mac';
}

/** 可用 target 一览文案（usage 与非法 target 报错共用） */
export function availableTargetsText() {
  const names = Object.keys(START_TARGETS).join(', ');
  const aliases = Object.entries(TARGET_ALIASES)
    .map(([from, to]) => `${from}=${to}`)
    .join(', ');
  return `${names}（别名: ${aliases}）`;
}

/**
 * target + platform → 仓库相对脚本路径（纯函数）。
 * @throws 非法 target 时抛错，错误信息包含可用 target 列表
 */
export function resolveScriptRelPath(target, platform = process.platform) {
  const canonical = canonicalTarget(target);
  if (!canonical) {
    throw new Error(`未知启动 target: ${target ?? '(空)'}。可用 target: ${availableTargetsText()}`);
  }
  const rel = START_TARGETS[canonical][platformKey(platform)];
  if (!rel) throw new Error(`target ${canonical} 在平台 ${platform} 无对应脚本`);
  return rel;
}

/** 用法说明（导出供测试断言文案稳定性） */
export function usageText() {
  const rows = Object.entries(START_TARGETS).map(
    ([name, t]) => `  ${name.padEnd(9)} ${t.description}（${path.basename(t.win)} / ${path.basename(t.mac)}）`,
  );
  const aliases = Object.entries(TARGET_ALIASES)
    .map(([from, to]) => `${from} → ${to}`)
    .join(', ');
  return [
    'Precis 跨平台统一启动入口 / Unified cross-platform launcher',
    '',
    '用法 / Usage:',
    '  node scripts/start.mjs <target>    （或 npm run start:<target>）',
    '',
    '可用 target（按当前平台自动分发 scripts/windows/*.bat 或 scripts/mac/*.sh）:',
    ...rows,
    '',
    `别名 / Aliases: ${aliases}`,
    'release-gui / pypi-gui 不经本入口: npm run release:gui / pypi:gui（scripts 下的 .bat/.sh 为双击便利入口）',
  ].join('\n');
}

// ============================================================================
// CLI 入口
// ============================================================================

function main() {
  const [target, ...extraArgs] = process.argv.slice(2);
  if (!target || target === '-h' || target === '--help') {
    console.log(usageText());
    process.exit(target ? 0 : 2);
  }

  let rel;
  try {
    rel = resolveScriptRelPath(target);
  } catch (err) {
    console.error(`[start] ${err.message}`);
    console.error(usageText());
    process.exit(2);
  }

  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    console.error(`[start] 平台脚本不存在: ${rel}`);
    process.exit(1);
  }

  console.error(`[start] ${canonicalTarget(target)} → ${rel}${extraArgs.length ? ` ${extraArgs.join(' ')}` : ''}`);
  runLauncher(abs, extraArgs);
}

/**
 * spawn 平台脚本并挂起当前进程直到其退出：
 * - Windows: .bat 必须经 shell（cmd.exe）解释执行（Node 自 CVE-2024-27980 起拒绝直接 spawn .bat），
 *   路径加内层引号兼容含空格的仓库路径，退出码经 cmd /c 原样转发
 * - macOS/Linux: 显式 bash 调用（与旧 npm 别名 `bash scripts/mac/*.sh` 行为一致，不依赖可执行位）
 * - SIGINT/SIGTERM/SIGHUP 转发给子进程；子进程被信号杀死时按 128+信号编号退出
 */
function runLauncher(absPath, extraArgs = []) {
  const child =
    process.platform === 'win32'
      ? spawn([`"${absPath}"`, ...extraArgs].join(' '), { stdio: 'inherit', shell: true })
      : spawn('bash', [absPath, ...extraArgs], { stdio: 'inherit' });

  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => {
      if (!child.killed) child.kill(sig);
    });
  }

  child.on('error', (err) => {
    console.error(`[start] 启动失败: ${err.message}`);
    process.exit(1);
  });
  child.on('close', (code, signal) => {
    if (code !== null && code !== undefined) process.exit(code);
    const sigNum = signal ? os.constants.signals[signal] : undefined;
    process.exit(typeof sigNum === 'number' ? 128 + sigNum : 1);
  });
}

// 直接执行时运行 CLI；被 import（单元测试）时不执行
if (process.argv[1] && pathToFileURL(process.argv[1]).href === pathToFileURL(SCRIPT_PATH).href) {
  main();
}
