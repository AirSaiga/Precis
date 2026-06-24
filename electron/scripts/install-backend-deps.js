#!/usr/bin/env node
/**
 * @fileoverview 为内嵌 Python 运行时安装后端运行时依赖
 *
 * 依赖清单来自 ../backend/requirements.txt（仅含第三方运行时依赖 + 传递依赖，
 * 禁止含 -e 自身可编辑安装——详见该文件顶部注释），直接 pip install 到内嵌
 * Python 的 site-packages 中。开发模式下若未下载内嵌运行时，则跳过。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

/** 内嵌 Python 解释器路径：Win 为 python-runtime/python/python.exe，其余为 bin/python3 */
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

  // requirements.txt 已是纯净的运行时依赖快照（无 -e 自身安装），直接安装即可
  execFileSync(pythonExe, ['-m', 'pip', 'install', '-r', requirementsPath], {
    stdio: 'inherit',
  });

  console.log('[install-backend-deps] 完成');
}

main();
