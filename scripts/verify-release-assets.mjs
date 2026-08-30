#!/usr/bin/env node
/**
 * @fileoverview GitHub Release 产物自检 —— 堵住 latest.yml 与实际资产命名/哈希漂移。
 *
 * 背景: 历史构建出现过 latest.yml 引用 "Precis-Setup-0.1.0.exe"（连字符）而实际资产为
 *       "Precis Setup 0.1.0.exe"（空格）的漂移，客户端下载更新直接 404。electron-updater
 *       只信 latest.yml，所以必须在 Release publish 后立刻验证两者一致。
 *
 * 检查项:
 *   1. Release 存在且非 draft（draft 对 electron-updater 不可见）
 *   2. 资产中存在 latest.yml（Windows NSIS 自动更新通道；latest-mac.yml 存在则一并验证）
 *   3. latest.yml 顶层 version == 期望版本
 *   4. files[].url 每个文件：资产存在、size 一致、sha512（base64 实测）一致
 *
 * 用法: node scripts/verify-release-assets.mjs --repo AirSaiga/Precis --tag v0.1.1 --version 0.1.1
 *   环境变量 GITHUB_TOKEN 可选（公开仓库匿名可读；提供时可访问 draft 便于预检）
 * 任何一项失败即 exit 1（CD release job 失败，人工介入修复）。
 */

import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);

/**
 * 解析 electron-builder 生成的 latest*.yml（无 YAML 依赖的最小行解析器，纯函数供测试）。
 * 只提取顶层 version 与 files 列表的 url/sha512/size —— 这是 electron-updater 消费的全部字段。
 */
export function parseLatestYml(text) {
  const version = /^version:[ \t]*(\S+)/m.exec(text)?.[1] ?? null;
  const files = [];
  let inFiles = false;
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    if (/^files:[ \t]*$/.test(line)) {
      inFiles = true;
      current = null;
      continue;
    }
    if (inFiles && /^\S/.test(line)) {
      // 顶格行（如 path:/sha512:）标志 files 列表结束
      inFiles = false;
      current = null;
    }
    if (!inFiles) continue;
    const urlMatch = /^ {2}-[ \t]*url:[ \t]*(\S+)/.exec(line);
    if (urlMatch) {
      current = { url: urlMatch[1] };
      files.push(current);
      continue;
    }
    if (current) {
      const kv = /^ {4}(sha512|size):[ \t]*(\S+)/.exec(line);
      if (kv) current[kv[1]] = kv[2];
    }
  }
  return { version, files };
}

function fail(msg) {
  console.error(`[verify-release-assets] FAIL: ${msg}`);
  process.exit(1);
}

async function githubApi(url, token) {
  const headers = { 'User-Agent': 'precis-release-check', Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers, redirect: 'manual' });
  return res;
}

async function downloadIntoHash(url, token) {
  const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}`, 'User-Agent': 'precis-release-check' } : { 'User-Agent': 'precis-release-check' } });
  if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}: ${url}`);
  const hash = createHash('sha512');
  let size = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    hash.update(value);
  }
  return { sha512: hash.digest('base64'), size };
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : null;
  };
  const repo = opt('repo');
  const tag = opt('tag');
  const expectedVersion = opt('version');
  const apiBase = opt('api') ?? 'https://api.github.com';
  const token = process.env.GITHUB_TOKEN ?? null;

  if (!repo || !tag) {
    console.error('用法: node scripts/verify-release-assets.mjs --repo <owner/name> --tag <vX.Y.Z> [--version <X.Y.Z>]');
    process.exit(2);
  }

  // 1. Release 存在 + 非 draft
  const relRes = await githubApi(`${apiBase}/repos/${repo}/releases/tags/${tag}`, token);
  if (relRes.status === 404) fail(`Release ${tag} 不存在`);
  if (!relRes.ok) fail(`查询 Release 失败 HTTP ${relRes.status}`);
  const release = await relRes.json();
  if (release.draft) fail(`Release ${tag} 仍是 draft —— electron-updater 看不见 draft，客户端将检测不到更新`);
  const assets = release.assets ?? [];
  console.log(`[verify-release-assets] Release ${tag}（${assets.length} 个资产）`);

  // 2. latest.yml（Windows 通道，必须存在）；latest-mac.yml（mac 构建，存在则验证）
  const ymlAssets = [
    { name: 'latest.yml', required: true },
    { name: 'latest-mac.yml', required: false },
  ];
  let checked = 0;

  for (const { name, required } of ymlAssets) {
    const asset = assets.find((a) => a.name === name);
    if (!asset) {
      if (required) fail(`缺少 ${name}（Windows NSIS 自动更新通道的版本清单）`);
      continue;
    }
    // 经 API blob URL 下载文件本体：必须带 Accept: application/octet-stream，
    // 否则 API 返回资产 JSON 元数据而非文件内容（首次发布 v0.1.1 时曾因此误报 version null）
    const ymlRes = await fetch(asset.url, {
      headers: {
        'User-Agent': 'precis-release-check',
        Accept: 'application/octet-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      redirect: 'follow',
    });
    if (!ymlRes.ok) fail(`下载 ${name} 失败 HTTP ${ymlRes.status}`);
    const ymlText = await ymlRes.text();
    const parsed = parseLatestYml(ymlText);

    // 3. version 匹配
    if (expectedVersion && parsed.version !== expectedVersion) {
      fail(`${name} 的 version 为 ${parsed.version}，期望 ${expectedVersion}`);
    }

    // 4. 逐文件核对资产存在性 + size + sha512
    if (parsed.files.length === 0) fail(`${name} 未解析到任何 files 条目`);
    for (const entry of parsed.files) {
      const target = assets.find((a) => a.name === entry.url || a.name === path.basename(entry.url));
      if (!target) fail(`${name} 引用的资产不存在于 Release: ${entry.url}`);
      if (entry.size && Number(entry.size) !== target.size) {
        fail(`资产 ${entry.url} size 不一致: latest.yml=${entry.size}, 实际=${target.size}`);
      }
      const { sha512 } = await downloadIntoHash(target.browser_download_url, token);
      if (entry.sha512 && sha512 !== entry.sha512) {
        fail(`资产 ${entry.url} sha512 不一致:\n  latest.yml=${entry.sha512}\n  实际    =${sha512}`);
      }
      checked += 1;
      console.log(`[verify-release-assets]   ✓ ${entry.url}（size ${target.size} / sha512 实测一致）`);
    }
    console.log(`[verify-release-assets] ✓ ${name} version=${parsed.version} 全部核对通过`);
  }

  console.log(`[verify-release-assets] 全部通过（${checked} 个产物文件实测哈希一致）`);
}

// 直接执行时运行 CLI；被 import（单元测试）时不执行
if (process.argv[1] && pathToFileURL(process.argv[1]).href === pathToFileURL(SCRIPT_PATH).href) {
  main().catch((err) => fail(err.message));
}
