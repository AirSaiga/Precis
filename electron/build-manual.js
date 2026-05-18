/**
 * @fileoverview 手动打包脚本
 * 
 * 功能概述:
 * - 手动复制文件到输出目录
 * - 使用本地已安装的 Electron 创建可执行应用
 * - 避免 electron-forge 的网络下载问题
 */

const fs = require('fs');
const path = require('path');

// 配置
const config = {
  // 应用名称
  appName: 'Precis',
  // 输出目录
  outDir: path.join(__dirname, 'release', 'Precis-win32-x64-new'),
  // Electron 可执行文件路径
  electronExe: path.join(__dirname, 'node_modules', 'electron', 'dist', 'electron.exe'),
  // 需要复制的文件和目录
  filesToCopy: [
    { from: 'dist', to: 'resources/app/dist' },
    { from: '../backend', to: 'resources/app/backend' },
    { from: '../frontend/dist', to: 'resources/app/frontend/dist' },
  ]
};

/**
 * 递归复制目录
 * @param {string} src - 源目录
 * @param {string} dest - 目标目录
 * @param {Set<string>} skipDirs - 要跳过的目录名集合
 */
function copyDir(src, dest, skipDirs = new Set()) {
  // 创建目标目录
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  // 读取源目录内容
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    // 跳过指定目录
    if (skipDirs.has(entry.name)) {
      continue;
    }

    if (entry.isDirectory()) {
      // 递归复制子目录
      copyDir(srcPath, destPath, skipDirs);
    } else {
      // 复制文件
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * 获取模块的所有依赖（递归）
 * @param {string} nodeModulesDir - node_modules 目录路径
 * @param {string} moduleName - 模块名
 * @param {Set<string>} collected - 已收集的依赖集合
 * @returns {Set<string>} - 所有依赖名称
 */
function getAllDependencies(nodeModulesDir, moduleName, collected = new Set()) {
  if (collected.has(moduleName)) {
    return collected;
  }
  
  collected.add(moduleName);
  
  const pkgPath = path.join(nodeModulesDir, moduleName, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    return collected;
  }
  
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  const deps = { ...pkg.dependencies, ...pkg.peerDependencies };
  
  for (const dep of Object.keys(deps || {})) {
    // 检查依赖是否存在（排除内置模块和 scoped packages 的特殊处理）
    const depPath = path.join(nodeModulesDir, dep);
    if (fs.existsSync(depPath)) {
      getAllDependencies(nodeModulesDir, dep, collected);
    }
  }
  
  return collected;
}

/**
 * 复制指定的 node_modules 依赖
 * @param {string} outDir - 输出目录
 */
function copyDependencies(outDir) {
  console.log('[BUILD] 复制依赖模块...');
  
  const nodeModulesDir = path.join(__dirname, 'node_modules');
  const destNodeModules = path.join(outDir, 'resources/app/node_modules');
  
  // 创建 node_modules 目录
  if (!fs.existsSync(destNodeModules)) {
    fs.mkdirSync(destNodeModules, { recursive: true });
  }

  // 需要复制的主依赖列表
  const mainDeps = [
    'electron-updater',
    'chalk',
    'electron-squirrel-startup'
  ];
  
  // 收集所有依赖（包括子依赖）
  const allDeps = new Set();
  for (const dep of mainDeps) {
    getAllDependencies(nodeModulesDir, dep, allDeps);
  }
  
  console.log(`[BUILD] 共需复制 ${allDeps.size} 个依赖模块`);
  
  // 复制所有收集到的依赖
  for (const dep of allDeps) {
    const srcDep = path.join(nodeModulesDir, dep);
    const destDep = path.join(destNodeModules, dep);
    
    if (fs.existsSync(srcDep)) {
      if (!fs.existsSync(destDep)) {
        copyDir(srcDep, destDep);
      }
    } else {
      console.warn(`[BUILD] 警告: 依赖不存在 ${dep}`);
    }
  }
}

/**
 * 主函数
 */
function main() {
  console.log('[BUILD] 开始手动打包...');

  // 检查 Electron 是否存在
  if (!fs.existsSync(config.electronExe)) {
    console.error('[BUILD] 错误: 找不到 Electron 可执行文件');
    console.error('[BUILD] 路径:', config.electronExe);
    process.exit(1);
  }

  // 清理并创建输出目录
  if (fs.existsSync(config.outDir)) {
    console.log('[BUILD] 清理旧版本...');
    try {
      fs.rmSync(config.outDir, { recursive: true, force: true });
    } catch (e) {
      console.warn('[BUILD] 清理旧版本失败，可能是文件被占用:', e.message);
      // 使用时间戳创建新目录
      const timestamp = Date.now();
      config.outDir = path.join(__dirname, 'release', `Precis-win32-x64-${timestamp}`);
    }
  }
  fs.mkdirSync(config.outDir, { recursive: true });

  // 复制 Electron 可执行文件
  console.log('[BUILD] 复制 Electron 可执行文件...');
  const destExe = path.join(config.outDir, `${config.appName}.exe`);
  fs.copyFileSync(config.electronExe, destExe);

  // 复制 Electron 依赖文件
  console.log('[BUILD] 复制 Electron 依赖文件...');
  const electronDist = path.dirname(config.electronExe);
  const files = fs.readdirSync(electronDist);
  for (const file of files) {
    if (file === 'electron.exe') continue; // 已复制并重命名
    
    const src = path.join(electronDist, file);
    const dest = path.join(config.outDir, file);
    
    if (fs.statSync(src).isDirectory()) {
      copyDir(src, dest);
    } else {
      fs.copyFileSync(src, dest);
    }
  }

  // 复制应用文件
  console.log('[BUILD] 复制应用文件...');
  for (const item of config.filesToCopy) {
    const src = path.resolve(__dirname, item.from);
    const dest = path.join(config.outDir, item.to);
    
    if (!fs.existsSync(src)) {
      console.warn(`[BUILD] 警告: 源文件不存在 ${src}`);
      continue;
    }

    console.log(`[BUILD] 复制 ${item.from} -> ${item.to}`);
    
    if (fs.statSync(src).isDirectory()) {
      copyDir(src, dest, new Set(['node_modules', '__pycache__']));
    } else {
      fs.copyFileSync(src, dest);
    }
  }

  // 复制依赖
  copyDependencies(config.outDir);

  // 创建 package.json
  console.log('[BUILD] 创建 package.json...');
  const packageJson = {
    name: 'precis-desktop',
    version: '1.0.0',
    description: 'Precis Desktop Application',
    main: 'dist/main.js',
    author: 'Precis Team',
    license: 'MIT'
  };
  fs.writeFileSync(
    path.join(config.outDir, 'resources/app/package.json'),
    JSON.stringify(packageJson, null, 2)
  );

  console.log('[BUILD] 打包完成!');
  console.log('[BUILD] 输出目录:', config.outDir);
  console.log('[BUILD] 可执行文件:', destExe);
}

main();
