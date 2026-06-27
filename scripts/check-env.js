#!/usr/bin/env node
/**
 * Precis 环境检查脚本
 * 
 * 检查项目运行所需的所有前置依赖
 * 用法: node scripts/check-env.js
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// 颜色
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  white: '\x1b[37m'
};

function log(type, message) {
  const color = colors[type] || colors.white;
  console.log(`${color}[${type.toUpperCase()}]${colors.reset} ${message}`);
}

function separator() {
  console.log(colors.cyan + '='.repeat(60) + colors.reset);
}

// 执行命令并返回输出
function runCommand(cmd, options = {}) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...options }).trim();
  } catch (e) {
    return null;
  }
}

// 检查版本号是否满足最低要求
function checkVersion(version, minVersion) {
  const parse = (v) => v.split('.').map(n => parseInt(n, 10));
  const v1 = parse(version.replace(/^v/, ''));
  const v2 = parse(minVersion);
  
  for (let i = 0; i < Math.max(v1.length, v2.length); i++) {
    const a = v1[i] || 0;
    const b = v2[i] || 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return true;
}

// 主检查函数
async function main() {
  separator();
  log('cyan', 'Precis 环境检查');
  separator();
  console.log('');

  const results = {
    python: { ok: false, version: null, required: '3.12.0' },
    node: { ok: false, version: null, required: '20.19.0' },
    npm: { ok: false, version: null, required: '10.0.0' },
    venv: { ok: false, exists: false },
    backendDeps: { ok: false, installed: false },
    frontendDeps: { ok: false, installed: false },
    electronDeps: { ok: false, installed: false }
  };

  // 1. 检查 Python
  log('cyan', '检查 Python...');
  // Windows: 优先尝试 `py -3` 启动器（避开 Microsoft Store 占位符），失败再回退 `python`。
  // 其它平台直接使用 `python3`，再回退 `python`。
  let pythonCmd = null;
  let pythonVersion = null;
  if (process.platform === 'win32') {
    const pyOut = runCommand('py -3 --version');
    if (pyOut && /Python \d+\.\d+\.\d+/.test(pyOut)) {
      pythonCmd = 'py -3';
      pythonVersion = pyOut;
    } else {
      pythonVersion = runCommand('python --version');
      if (pythonVersion) pythonCmd = 'python';
    }
  } else {
    pythonVersion = runCommand('python3 --version');
    if (pythonVersion) {
      pythonCmd = 'python3';
    } else {
      pythonVersion = runCommand('python --version');
      if (pythonVersion) pythonCmd = 'python';
    }
  }

  if (pythonVersion) {
    const match = pythonVersion.match(/Python (\d+\.\d+\.\d+)/);
    if (match) {
      results.python.version = match[1];
      results.python.ok = checkVersion(match[1], results.python.required);
      if (results.python.ok) {
        log('green', `Python ${match[1]} ✓`);
      } else {
        log('yellow', `Python ${match[1]} (需要 ${results.python.required}+)`);
      }
    }
  } else {
    log('red', 'Python 未找到');
  }

  // 2. 检查 Node.js
  log('cyan', '检查 Node.js...');
  const nodeVersion = runCommand('node --version');
  if (nodeVersion) {
    results.node.version = nodeVersion.replace(/^v/, '');
    results.node.ok = checkVersion(results.node.version, results.node.required);
    if (results.node.ok) {
      log('green', `Node.js ${results.node.version} ✓`);
    } else {
      log('yellow', `Node.js ${results.node.version} (需要 ${results.node.required}+)`);
    }
  } else {
    log('red', 'Node.js 未找到');
  }

  // 3. 检查 npm
  log('cyan', '检查 npm...');
  const npmVersion = runCommand('npm --version');
  if (npmVersion) {
    results.npm.version = npmVersion;
    results.npm.ok = checkVersion(npmVersion, results.npm.required);
    if (results.npm.ok) {
      log('green', `npm v${npmVersion} ✓`);
    } else {
      log('yellow', `npm v${npmVersion} (建议 ${results.npm.required}+)`);
    }
  } else {
    log('red', 'npm 未找到');
  }

  console.log('');
  separator();
  log('cyan', '检查项目依赖');
  separator();
  console.log('');

  // 4. 检查虚拟环境
  log('cyan', '检查虚拟环境...');
  const venvPath = path.join(__dirname, '..', 'backend', '.venv');
  if (fs.existsSync(venvPath)) {
    results.venv.exists = true;
    results.venv.ok = true;
    log('green', '虚拟环境已创建 ✓');
  } else {
    log('yellow', '虚拟环境未创建 (运行 setup 脚本创建)');
  }

  // 5. 检查后端依赖
  log('cyan', '检查后端依赖...');
  try {
    // 优先使用虚拟环境中的 python；否则使用前面检测到的 pythonCmd
    // （pythonCmd 在 Windows 上可能是 "py -3"，不可直接 fs.existsSync）
    let pythonPath = null;
    if (results.venv.exists) {
      const candidate = path.join(venvPath, process.platform === 'win32' ? 'Scripts\\python.exe' : 'bin/python');
      if (fs.existsSync(candidate)) pythonPath = `"${candidate}"`;
    }
    if (!pythonPath && pythonCmd) {
      pythonPath = pythonCmd; // 已是可执行命令字符串（如 python / python3 / py -3）
    }

    if (pythonPath) {
      const check = runCommand(`${pythonPath} -c "import fastapi,pydantic,pandas,yaml;print('OK')" 2>&1`);
      if (check === 'OK') {
        results.backendDeps.installed = true;
        results.backendDeps.ok = true;
        log('green', '后端依赖已安装 ✓');
      } else {
        log('yellow', '后端依赖未安装');
      }
    }
  } catch (e) {
    log('yellow', '后端依赖检查失败');
  }

  // 6. 检查前端依赖
  log('cyan', '检查前端依赖...');
  const frontendNodeModules = path.join(__dirname, '..', 'frontend', 'node_modules');
  if (fs.existsSync(frontendNodeModules)) {
    results.frontendDeps.installed = true;
    results.frontendDeps.ok = true;
    log('green', '前端依赖已安装 ✓');
  } else {
    log('yellow', '前端依赖未安装');
  }

  // 7. 检查 Electron 依赖
  log('cyan', '检查 Electron 依赖...');
  const electronNodeModules = path.join(__dirname, '..', 'electron', 'node_modules');
  if (fs.existsSync(electronNodeModules)) {
    results.electronDeps.installed = true;
    results.electronDeps.ok = true;
    log('green', 'Electron 依赖已安装 ✓');
  } else {
    log('yellow', 'Electron 依赖未安装');
  }

  // 8. 检查构建产物
  log('cyan', '检查构建产物...');
  const frontendDist = path.join(__dirname, '..', 'frontend', 'dist');
  if (fs.existsSync(frontendDist)) {
    log('green', '前端已构建 ✓');
  } else {
    log('yellow', '前端未构建 (运行 npm run frontend:build)');
  }

  console.log('');
  separator();
  
  // 总结
  const allOk = results.python.ok && results.node.ok && results.backendDeps.ok && 
                results.frontendDeps.ok && results.electronDeps.ok;
  
  if (allOk) {
    log('green', '✓ 环境检查通过！可以启动应用');
    separator();
    console.log('');
    log('cyan', '可用命令:');
    console.log(`  ${colors.white}npm run start:cli:win${colors.reset}        - 启动 CLI (Windows)`);
    console.log(`  ${colors.white}npm run start:cli:mac${colors.reset}        - 启动 CLI (Mac/Linux)`);
    console.log(`  ${colors.white}npm run start:electron:win${colors.reset}   - 启动桌面版 (Windows)`);
    console.log(`  ${colors.white}npm run start:desktop:mac${colors.reset}   - 启动桌面版 (Mac/Linux)`);
    console.log(`  ${colors.white}npm run dev${colors.reset}                  - 启动开发服务器`);
  } else {
    log('yellow', '⚠ 环境检查未通过');
    separator();
    console.log('');
    
    const missing = [];
    if (!results.python.ok) missing.push('Python 3.12+');
    if (!results.node.ok) missing.push('Node.js 20.19+');
    if (!results.venv.exists || !results.backendDeps.ok) missing.push('后端依赖');
    if (!results.frontendDeps.ok) missing.push('前端依赖');
    if (!results.electronDeps.ok) missing.push('Electron 依赖');
    
    log('cyan', `缺失: ${missing.join(', ')}`);
    console.log('');
    log('cyan', 'Python 3.12 安装指南:');
    if (process.platform === 'win32') {
      console.log(`  ${colors.white}# 使用 pyenv-win (推荐)${colors.reset}`);
      console.log(`  ${colors.white}pyenv install 3.12.9${colors.reset}`);
      console.log(`  ${colors.white}pyenv global 3.12.9${colors.reset}`);
      console.log('');
      console.log(`  ${colors.white}# 或从官网下载${colors.reset}`);
      console.log(`  ${colors.white}https://www.python.org/downloads/release/python-3129/${colors.reset}`);
    } else {
      console.log(`  ${colors.white}# 使用 pyenv (推荐)${colors.reset}`);
      console.log(`  ${colors.white}pyenv install 3.12.9${colors.reset}`);
      console.log(`  ${colors.white}pyenv global 3.12.9${colors.reset}`);
      console.log('');
      console.log(`  ${colors.white}# 或使用包管理器${colors.reset}`);
      console.log(`  ${colors.white}brew install python@3.12  # macOS${colors.reset}`);
      console.log(`  ${colors.white}sudo apt install python3.12 python3.12-venv  # Ubuntu/Debian${colors.reset}`);
    }
    console.log('');
    log('cyan', '请运行部署脚本:');
    if (process.platform === 'win32') {
      console.log(`  ${colors.white}.\\scripts\\setup.ps1${colors.reset}`);
    } else {
      console.log(`  ${colors.white}./scripts/setup.sh${colors.reset}`);
    }
  }
  
  console.log('');
  process.exit(allOk ? 0 : 1);
}

main().catch(err => {
  log('red', `检查失败: ${err.message}`);
  process.exit(1);
});
