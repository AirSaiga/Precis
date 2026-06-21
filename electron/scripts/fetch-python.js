#!/usr/bin/env node
/**
 * @fileoverview 下载 python-build-standalone 运行时到 electron/resources/python-runtime/
 *
 * 该脚本在构建前执行，按当前平台/架构下载对应 release，解压并整理目录结构，
 * 供 electron-builder 通过 extraResources 打包进安装包。
 *
 * 目录结构约定（与 main.ts 中的 resolvePythonExecutable 对齐）：
 * - Windows: resources/python-runtime/python/python.exe
 * - macOS/Linux: resources/python-runtime/bin/python3
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const os = require('os');

const PYTHON_VERSION = '3.12.13';
const RELEASE_TAG = '20260610';

function getPlatformTriple() {
  const platform = os.platform();
  const arch = os.arch();

  if (platform === 'win32' && arch === 'x64') {
    return 'x86_64-pc-windows-msvc';
  }
  if (platform === 'darwin' && arch === 'arm64') {
    return 'aarch64-apple-darwin';
  }
  if (platform === 'darwin' && arch === 'x64') {
    return 'x86_64-apple-darwin';
  }
  if (platform === 'linux' && arch === 'x64') {
    return 'x86_64-unknown-linux-gnu';
  }

  throw new Error(`不支持的平台/架构: ${platform}/${arch}`);
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https
      .get(url, { redirect: 'follow' }, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          // 处理 GitHub release 重定向
          file.close();
          fs.unlinkSync(dest);
          return downloadFile(response.headers.location, dest).then(resolve, reject);
        }
        if (response.statusCode !== 200) {
          file.close();
          fs.unlinkSync(dest);
          return reject(new Error(`下载失败: ${url}，状态码 ${response.statusCode}`));
        }
        response.pipe(file);
        file.on('finish', () => {
          file.close(resolve);
        });
      })
      .on('error', (err) => {
        try {
          fs.unlinkSync(dest);
        } catch {
          // 忽略清理失败
        }
        reject(err);
      });
    file.on('error', reject);
  });
}

function rmrf(target) {
  if (!fs.existsSync(target)) return;
  fs.rmSync(target, { recursive: true, force: true });
}

function findSingleSubdir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const subdirs = entries.filter((e) => e.isDirectory());
  if (subdirs.length === 1) {
    return path.join(dir, subdirs[0].name);
  }
  return dir;
}

function findFile(dir, name) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(full, name);
      if (found) return found;
    } else if (entry.name === name) {
      return full;
    }
  }
  return undefined;
}

async function main() {
  const triple = getPlatformTriple();
  const archiveName = `cpython-${PYTHON_VERSION}+${RELEASE_TAG}-${triple}-install_only.tar.gz`;
  const downloadUrl = `https://github.com/astral-sh/python-build-standalone/releases/download/${RELEASE_TAG}/${archiveName}`;

  const repoRoot = path.resolve(__dirname, '..');
  const resourcesDir = path.join(repoRoot, 'resources');
  const runtimeDir = path.join(resourcesDir, 'python-runtime');
  const tmpDir = path.join(resourcesDir, 'python-runtime-tmp');
  const archivePath = path.join(resourcesDir, archiveName);

  if (fs.existsSync(runtimeDir)) {
    const platform = os.platform();
    const expectedExe =
      platform === 'win32'
        ? path.join(runtimeDir, 'python', 'python.exe')
        : path.join(runtimeDir, 'bin', 'python3');
    if (fs.existsSync(expectedExe)) {
      console.log(`[fetch-python] 内嵌运行时已存在: ${expectedExe}`);
      return;
    }
    console.log('[fetch-python] 运行时目录存在但结构不完整，重新下载');
    rmrf(runtimeDir);
  }

  fs.mkdirSync(resourcesDir, { recursive: true });
  rmrf(tmpDir);
  fs.mkdirSync(tmpDir, { recursive: true });

  console.log(`[fetch-python] 下载 ${archiveName}...`);
  console.log(`[fetch-python] URL: ${downloadUrl}`);
  await downloadFile(downloadUrl, archivePath);

  console.log('[fetch-python] 解压...');
  // Windows 10+ 自带 tar.exe，Git Bash 也有 tar；macOS/Linux 必然有 tar
  // 使用 cwd + 相对路径避免 Windows tar.exe 对绝对路径（含冒号/反斜杠）解析失败
  const currentPlatform = os.platform();
  const tarCmd = currentPlatform === 'win32' ? 'tar.exe' : 'tar';
  try {
    execFileSync(tarCmd, ['-xzf', archiveName, '-C', 'python-runtime-tmp'], {
      cwd: resourcesDir,
      stdio: 'inherit',
    });
  } catch (err) {
    rmrf(tmpDir);
    rmrf(archivePath);
    throw new Error(`解压失败: ${err.message}`);
  }

  // python-build-standalone install_only 包通常只有一个顶层目录
  const extractedDir = findSingleSubdir(tmpDir);
  console.log(`[fetch-python] 解压到: ${extractedDir}`);

  // 验证可执行文件存在
  const exeName = currentPlatform === 'win32' ? 'python.exe' : 'python3';
  const foundExe = findFile(extractedDir, exeName);
  if (!foundExe) {
    rmrf(tmpDir);
    rmrf(archivePath);
    throw new Error(`解压后未找到 ${exeName}`);
  }
  console.log(`[fetch-python] 找到解释器: ${foundExe}`);

  // 整理成 main.ts 期望的目录结构
  if (currentPlatform === 'win32') {
    // 期望 python-runtime/python/python.exe
    // 通常解压顶层就是 python/，直接重命名即可
    fs.mkdirSync(runtimeDir, { recursive: true });
    const srcPythonDir = path.join(extractedDir, 'python');
    if (fs.existsSync(srcPythonDir)) {
      fs.renameSync(srcPythonDir, path.join(runtimeDir, 'python'));
    } else {
      // 兜底：把解压内容整体放进 python/ 子目录
      fs.mkdirSync(path.join(runtimeDir, 'python'), { recursive: true });
      for (const entry of fs.readdirSync(extractedDir)) {
        fs.renameSync(path.join(extractedDir, entry), path.join(runtimeDir, 'python', entry));
      }
    }
  } else {
    // 期望 python-runtime/bin/python3
    // 通常解压顶层是 install/，包含 bin/python3
    fs.mkdirSync(runtimeDir, { recursive: true });
    for (const entry of fs.readdirSync(extractedDir)) {
      fs.renameSync(path.join(extractedDir, entry), path.join(runtimeDir, entry));
    }
  }

  // 清理
  rmrf(tmpDir);
  rmrf(archivePath);

  const finalExe =
    currentPlatform === 'win32'
      ? path.join(runtimeDir, 'python', 'python.exe')
      : path.join(runtimeDir, 'bin', 'python3');
  if (!fs.existsSync(finalExe)) {
    throw new Error(`整理后的运行时缺少可执行文件: ${finalExe}`);
  }
  console.log(`[fetch-python] 完成: ${finalExe}`);
}

main().catch((err) => {
  console.error('[fetch-python] 错误:', err.message);
  process.exit(1);
});
