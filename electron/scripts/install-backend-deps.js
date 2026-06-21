#!/usr/bin/env node
/**
 * @fileoverview 为内嵌 Python 运行时安装后端依赖
 *
 * 依赖清单来自 ../backend/requirements.txt，安装到内嵌 Python 的 site-packages 中。
 * 开发模式下若未下载内嵌运行时，则直接跳过。
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const os = require('os');

function getPythonExecutable(runtimeDir) {
  const platform = os.platform();
  if (platform === 'win32') {
    return path.join(runtimeDir, 'python', 'python.exe');
  }
  return path.join(runtimeDir, 'bin', 'python3');
}

function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const runtimeDir = path.join(repoRoot, 'resources', 'python-runtime');
  const pythonExe = getPythonExecutable(runtimeDir);
  const requirementsPath = path.resolve(__dirname, '..', '..', 'backend', 'requirements.txt');

  // 开发模式未下载内嵌运行时，跳过安装
  if (!fs.existsSync(pythonExe)) {
    console.log('[install-backend-deps] 未找到内嵌 Python 运行时，跳过依赖安装（开发模式）');
    return;
  }

  if (!fs.existsSync(requirementsPath)) {
    throw new Error(`未找到依赖文件: ${requirementsPath}`);
  }

  console.log(`[install-backend-deps] 使用解释器: ${pythonExe}`);
  console.log(`[install-backend-deps] 安装依赖: ${requirementsPath}`);

  try {
    execFileSync(
      pythonExe,
      ['-m', 'pip', 'install', '-r', requirementsPath],
      { stdio: 'inherit' }
    );
  } catch (err) {
    throw new Error(`依赖安装失败: ${err.message}`);
  }

  console.log('[install-backend-deps] 完成');
}

main();
