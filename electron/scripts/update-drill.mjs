#!/usr/bin/env node
/**
 * @fileoverview 本地"模拟生产"更新演练工具
 *
 * 两种模式:
 *
 * lite（分钟级，复用一次真实构建产物）:
 *   node scripts/update-drill.mjs lite [--version 9.9.9-drill]
 *   - 从 electron/release/ 复制真实安装包 + latest.yml 到 local-updates/
 *   - 仅抬升 latest.yml 的 version 字段（sha512/size 保持真实值，下载校验可通过）
 *   - 验证链路: 检测更新 → 下载进度 → 重启安装 UI 全流程
 *   - 局限: 安装的仍是同一二进制，应用版本号不变——验证的是流程，不是真实升级
 *
 * full（全真闭环，构建两个真实版本，约 10-30 分钟）:
 *   node scripts/update-drill.mjs full [--base 0.1.0] [--next 0.1.1]
 *   - 用 electron-builder --config.extraMetadata.version 分别构建基线版与新版
 *     （不污染工作区 package.json）
 *   - 基线安装包存 local-updates/base/，新版产物作为更新源
 *   - 验证链路: 装基线 → 本地源检测到新版 → 下载 → 安装 → 版本真实变更
 *     （含 extraResources 全量替换、后端 PRECIS_APP_VERSION 跟随更新）
 *
 * 演练步骤（两种模式相同）:
 *   1. 生成本地更新源（本脚本）
 *   2. 启动本地源: npm run serve:updates（默认 http://localhost:8080）
 *   3. 在应用 设置 → 自动更新 中把更新源切到 custom + http://localhost:8080
 *   4. 点"检查更新" → 下载 → 重启安装
 *   5. 演练完把更新源切回 github，删除 local-updates/ 内容
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_PATH);
const ELECTRON_DIR = path.resolve(SCRIPT_DIR, '..');
const ROOT = path.resolve(ELECTRON_DIR, '..');
/** 可用 --release <dir> 指向其他构建输出目录（多版本产物复用/测试） */
const RELEASE_DIR = path.resolve(ELECTRON_DIR, opt('release') ?? 'release');
const FEED_DIR = path.join(ELECTRON_DIR, 'local-updates');
const BASE_DIR = path.join(FEED_DIR, 'base');

/** 从根 scripts 复用 latest.yml 最小解析器（单一实现，避免脚本间副本漂移） */
async function loadLatestYmlParser() {
  const mod = await import('../../scripts/verify-release-assets.mjs');
  return mod.parseLatestYml;
}

function opt(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function bumpPatch(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!m) throw new Error(`无法从版本号推导下一版本: ${version}`);
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

function run(cmd, cwd, label) {
  console.log(`\n[drill] >>> ${label ?? cmd}`);
  const r = spawnSync(cmd, { shell: true, cwd, stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`命令失败（exit ${r.status}）: ${cmd}`);
}

/** 把 electron/release 里的 latest.yml 引用的产物 + yml 本身复制到目标目录 */
async function copyReleaseArtifacts(targetDir, { versionOverride = null } = {}) {
  const parseLatestYml = await loadLatestYmlParser();
  const ymlPath = path.join(RELEASE_DIR, 'latest.yml');
  if (!fs.existsSync(ymlPath)) {
    throw new Error(`未找到 ${ymlPath}\n请先构建: 在仓库根目录运行 npm run dist:win`);
  }
  const yml = fs.readFileSync(ymlPath, 'utf-8');
  const parsed = parseLatestYml(yml);
  fs.mkdirSync(targetDir, { recursive: true });

  for (const entry of parsed.files) {
    const src = path.join(RELEASE_DIR, entry.url);
    if (!fs.existsSync(src)) {
      throw new Error(`latest.yml 引用的产物不存在: ${src}（构建产物与清单漂移）`);
    }
    fs.copyFileSync(src, path.join(targetDir, entry.url));
    console.log(`[drill] 复制产物: ${entry.url}（${entry.size} 字节）`);
  }

  // 版本覆写：只改 version 行，sha512/size/path 保持真实值（同文件，校验可通过）
  const outYml = versionOverride
    ? yml.replace(/^version:[ \t]*\S+$/m, `version: ${versionOverride}`)
    : yml;
  fs.writeFileSync(path.join(targetDir, 'latest.yml'), outYml, 'utf-8');
  console.log(`[drill] 写入 latest.yml（version: ${versionOverride ?? parsed.version}）`);
  return versionOverride ?? parsed.version;
}

function printDrillSteps(feedVersion, { sameBinary }) {
  console.log(`
=====================================================================
 本地更新源就绪（版本 ${feedVersion}）
=====================================================================
后续步骤:
  1. 启动本地更新源服务器:
       cd electron && npm run serve:updates        # http://localhost:8080
  2. ${sameBinary ? '启动已安装的 Precis（任意已发布版本）' : '安装 local-updates/base/ 下的基线安装包并启动'}
  3. 应用内 设置 → 自动更新:
       更新源 = 自定义(custom)  URL = http://localhost:8080
  4. 点"检查更新" → 应发现 ${feedVersion} → 下载 → 重启安装
  5. ${sameBinary
        ? '注意: lite 模式安装的是同一二进制，应用版本号不会变——验证的是检测/下载/安装流程'
        : '安装后应用"关于"处版本应为 ' + feedVersion + '，后端 /api/latest/version 同步返回该版本'}
  6. 演练完毕: 更新源切回 github，删除 electron/local-updates/ 内容
=====================================================================
`);
}

// ---------------------------------------------------------------------------
// lite 模式
// ---------------------------------------------------------------------------
async function modeLite() {
  const packageVersion = JSON.parse(fs.readFileSync(path.join(ELECTRON_DIR, 'package.json'), 'utf-8')).version;
  const drillVersion = opt('version') ?? bumpPatch(packageVersion);
  if (fs.existsSync(FEED_DIR)) {
    fs.rmSync(FEED_DIR, { recursive: true, force: true });
  }
  const feedVersion = await copyReleaseArtifacts(FEED_DIR, { versionOverride: drillVersion });
  printDrillSteps(feedVersion, { sameBinary: true });
}

// ---------------------------------------------------------------------------
// full 模式
// ---------------------------------------------------------------------------
async function modeFull() {
  const packageVersion = JSON.parse(fs.readFileSync(path.join(ELECTRON_DIR, 'package.json'), 'utf-8')).version;
  const baseVersion = opt('base') ?? packageVersion;
  const nextVersion = opt('next') ?? bumpPatch(baseVersion);

  console.log(`[drill] full 模式: 基线 ${baseVersion} → 新版 ${nextVersion}`);
  console.log('[drill] 将执行两次完整打包（前端构建 + tsc + 内嵌 Python + electron-builder），预计 10-30 分钟');

  if (fs.existsSync(FEED_DIR)) {
    fs.rmSync(FEED_DIR, { recursive: true, force: true });
  }

  // ---- 构建基线 ----
  console.log(`\n[drill] ========== 构建基线 ${baseVersion} ==========`);
  run('npm run build-only', path.join(ROOT, 'frontend'), '前端构建（frontend）');
  run('npx tsc', ELECTRON_DIR, 'Electron 主进程编译');
  run('node scripts/fetch-python.js', ELECTRON_DIR, '拉取内嵌 Python 运行时（已缓存则跳过下载）');
  run('node scripts/install-backend-deps.js', ELECTRON_DIR, '安装后端依赖到运行时');
  run(
    `npx electron-builder --win --publish never${baseVersion === packageVersion ? '' : ` --config.extraMetadata.version=${baseVersion}`}`,
    ELECTRON_DIR,
    `打包基线安装包 ${baseVersion}`,
  );
  fs.mkdirSync(BASE_DIR, { recursive: true });
  for (const f of fs.readdirSync(RELEASE_DIR)) {
    if (fs.statSync(path.join(RELEASE_DIR, f)).isFile()) {
      fs.copyFileSync(path.join(RELEASE_DIR, f), path.join(BASE_DIR, f));
    }
  }
  console.log(`[drill] 基线产物已存 ${path.relative(ROOT, BASE_DIR)}/`);

  // ---- 构建新版 ----
  console.log(`\n[drill] ========== 构建新版 ${nextVersion} ==========`);
  run(
    `npx electron-builder --win --publish never --config.extraMetadata.version=${nextVersion}`,
    ELECTRON_DIR,
    `打包新版安装包 ${nextVersion}`,
  );
  const feedVersion = await copyReleaseArtifacts(FEED_DIR);
  if (feedVersion !== nextVersion) {
    throw new Error(`新版构建产物版本(${feedVersion})与期望(${nextVersion})不符，请检查`);
  }
  printDrillSteps(feedVersion, { sameBinary: false });
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------
async function main() {
  const mode = process.argv[2] ?? 'help';
  try {
    if (mode === 'lite') await modeLite();
    else if (mode === 'full') await modeFull();
    else {
      console.log(`Precis 本地更新演练工具

用法:
  node scripts/update-drill.mjs lite [--version 9.9.9-drill]   分钟级流程演练（复用真实构建产物，仅抬升清单版本号）
  node scripts/update-drill.mjs full [--base 0.1.0] [--next 0.1.1]   全真闭环（构建两个真实版本，10-30 分钟）

前置: lite 需要先有 electron/release/ 构建产物（npm run dist:win）`);
    }
  } catch (err) {
    console.error(`\n[drill] 失败: ${err.message}`);
    process.exit(1);
  }
}

// 直接执行时运行 CLI；被 import 时不执行
if (process.argv[1] && pathToFileURL(process.argv[1]).href === pathToFileURL(SCRIPT_PATH).href) {
  main();
}
