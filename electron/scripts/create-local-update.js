/**
 * @fileoverview 本地模拟更新源管理脚本
 *
 * 功能概述:
 * - 创建和管理本地模拟更新源
 * - 生成 latest.yml 版本信息文件
 * - 创建模拟更新包供测试使用
 *
 * 使用方法:
 * - 运行 node scripts/create-local-update.js 来创建模拟更新
 * - 修改 version 参数来生成不同版本的更新
 */

const fs = require('fs');
const path = require('path');

const LOCAL_UPDATE_DIR = path.join(__dirname, '..', 'local-updates');
const RELEASES_DIR = path.join(LOCAL_UPDATE_DIR, 'releases');

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`[LocalUpdate] 创建目录: ${dirPath}`);
  }
}

function createLatestYml(version, releaseNotes = '这是一个测试更新版本') {
  ensureDir(LOCAL_UPDATE_DIR);

  const currentVersion = require('../package.json').version;
  const releaseDate = new Date().toISOString();

  const ymlContent = `version: ${version}
releaseDate: ${releaseDate}
releaseNotes:
  - note: ${releaseNotes}
    type: new
files:
  - url: releases/Precis-${version}-win32-x64.zip
    sha512: dummy-sha512-for-testing
    size: 1024000
path: Precis-${version}-win32-x64.zip
sha512: dummy-sha512-for-testing
size: 1024000
`;

  const latestYmlPath = path.join(LOCAL_UPDATE_DIR, 'latest.yml');
  fs.writeFileSync(latestYmlPath, ymlContent, 'utf-8');
  console.log(`[LocalUpdate] 已创建 latest.yml，版本: ${version}`);
  console.log(`[LocalUpdate] 文件路径: ${latestYmlPath}`);
}

function createMockUpdatePackage(version) {
  ensureDir(RELEASES_DIR);

  const packageName = `Precis-${version}-win32-x64.zip`;
  const packagePath = path.join(RELEASES_DIR, packageName);

  const mockContent = Buffer.alloc(1024 * 10);
  mockContent.fill(0);

  fs.writeFileSync(packagePath, mockContent);
  console.log(`[LocalUpdate] 已创建模拟更新包: ${packageName}`);
  console.log(`[LocalUpdate] 文件路径: ${packagePath}`);
}

function getCurrentVersion() {
  const packageJson = require('../package.json');
  return packageJson.version;
}

function parseVersion(versionStr) {
  const parts = versionStr.split('.').map(Number);
  return {
    major: parts[0] || 0,
    minor: parts[1] || 0,
    patch: parts[2] || 0
  };
}

function incrementVersion(currentVersion, type = 'patch') {
  const v = parseVersion(currentVersion);

  switch (type) {
    case 'major':
      v.major += 1;
      v.minor = 0;
      v.patch = 0;
      break;
    case 'minor':
      v.minor += 1;
      v.patch = 0;
      break;
    case 'patch':
    default:
      v.patch += 1;
      break;
  }

  return `${v.major}.${v.minor}.${v.patch}`;
}

function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  const currentVersion = getCurrentVersion();

  switch (command) {
    case 'create':
      const newVersion = args[1] || incrementVersion(currentVersion);
      const releaseNotes = args.slice(2).join(' ') || `更新版本 ${newVersion}`;
      createLatestYml(newVersion, releaseNotes);
      createMockUpdatePackage(newVersion);
      console.log(`\n[LocalUpdate] 模拟更新创建完成！`);
      console.log(`[LocalUpdate] 当前版本: ${currentVersion}`);
      console.log(`[LocalUpdate] 新版本: ${newVersion}`);
      console.log(`[LocalUpdate] 更新源路径: ${LOCAL_UPDATE_DIR}`);
      break;

    case 'version':
      console.log(`当前应用版本: ${currentVersion}`);
      break;

    case 'next':
      const type = args[1] || 'patch';
      const nextVersion = incrementVersion(currentVersion, type);
      console.log(`下一个版本 (${type}): ${nextVersion}`);
      break;

    case 'init':
      ensureDir(LOCAL_UPDATE_DIR);
      ensureDir(RELEASES_DIR);
      console.log(`[LocalUpdate] 本地更新目录初始化完成: ${LOCAL_UPDATE_DIR}`);
      break;

    default:
      console.log('用法:');
      console.log('  node scripts/create-local-update.js create [version] [notes]  - 创建模拟更新');
      console.log('  node scripts/create-local-update.js version                      - 显示当前版本');
      console.log('  node scripts/create-local-update.js next [patch|minor|major]    - 显示下一版本');
      console.log('  node scripts/create-local-update.js init                         - 初始化目录结构');
      break;
  }
}

main();
