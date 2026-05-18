---
name: "electron-desktop"
description: "Precis Electron 桌面壳开发规范。适用于 electron/src/ 下的主进程、预加载脚本、IPC 通信、自动更新等模块。"
scope: ["electron/src/**/*.ts", "electron/scripts/**/*.js"]
---

# Precis Electron 桌面壳开发规范

## 适用范围

- 主进程（main.ts）
- 预加载脚本（preload.ts）
- 自动更新（update.ts）
- 本地更新脚本（create-local-update.js）
- IPC 通信接口

## 架构分层

Electron 应用严格遵循 **主进程 / 渲染进程 / 预加载脚本** 三层分离：

```
electron/
├── src/
│   ├── main.ts          # 主进程：窗口管理、系统交互、IPC 处理
│   ├── preload.ts       # 预加载脚本：安全桥接，暴露受控 API
│   └── update.ts        # 自动更新：检查、下载、安装更新
├── scripts/
│   ├── start.js         # 开发启动脚本
│   └── create-local-update.js  # 本地更新包生成
└── package.json
```

## 主进程规范（main.ts）

### 窗口创建

```typescript
import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'path'

class PrecisApp {
  private mainWindow: BrowserWindow | null = null
  
  async createWindow(): Promise<void> {
    this.mainWindow = new BrowserWindow({
      width: 1400,
      height: 900,
      minWidth: 1024,
      minHeight: 768,
      webPreferences: {
        // 必须启用上下文隔离
        contextIsolation: true,
        // 禁用 Node.js 集成（安全最佳实践）
        nodeIntegration: false,
        // 预加载脚本路径
        preload: path.join(__dirname, 'preload.js')
      },
      titleBarStyle: 'hiddenInset',
      show: false  // 准备好内容后再显示
    })
    
    // 加载前端内容
    if (process.env.NODE_ENV === 'development') {
      await this.mainWindow.loadURL('http://localhost:5173')
      this.mainWindow.webContents.openDevTools()
    } else {
      await this.mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
    }
    
    this.mainWindow.once('ready-to-show', () => {
      this.mainWindow?.show()
    })
  }
  
  setupIPC(): void {
    // ============================================================================
    // 文件系统操作（主进程执行，渲染进程通过 IPC 调用）
    // ============================================================================
    
    ipcMain.handle('fs:readFile', async (_, filePath: string) => {
      // 路径安全检查
      if (!this.isPathAllowed(filePath)) {
        throw new Error('路径不在允许范围内')
      }
      
      const fs = await import('fs/promises')
      return fs.readFile(filePath, 'utf-8')
    })
    
    ipcMain.handle('fs:writeFile', async (_, filePath: string, content: string) => {
      if (!this.isPathAllowed(filePath)) {
        throw new Error('路径不在允许范围内')
      }
      
      const fs = await import('fs/promises')
      await fs.writeFile(filePath, content, 'utf-8')
      return true
    })
    
    // ============================================================================
    // 系统对话框
    // ============================================================================
    
    ipcMain.handle('dialog:openFile', async (_, options) => {
      const { dialog } = await import('electron')
      const result = await dialog.showOpenDialog(this.mainWindow!, {
        properties: ['openFile'],
        filters: options.filters || []
      })
      return result.filePaths
    })
  }
  
  private isPathAllowed(filePath: string): boolean {
    // 实现路径白名单校验
    const allowedPaths = [
      app.getPath('documents'),
      app.getPath('downloads')
    ]
    return allowedPaths.some(allowed => filePath.startsWith(allowed))
  }
}

// 应用生命周期
const precisApp = new PrecisApp()

app.whenReady().then(() => {
  precisApp.createWindow()
  precisApp.setupIPC()
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      precisApp.createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
```

## 预加载脚本规范（preload.ts）

预加载脚本是主进程与渲染进程之间的**安全桥梁**：

```typescript
import { contextBridge, ipcRenderer } from 'electron'

// ============================================================================
// 暴露给渲染进程的受控 API
// ============================================================================

contextBridge.exposeInMainWorld('electronAPI', {
  // 文件系统
  fs: {
    readFile: (path: string): Promise<string> => 
      ipcRenderer.invoke('fs:readFile', path),
    writeFile: (path: string, content: string): Promise<boolean> => 
      ipcRenderer.invoke('fs:writeFile', path, content)
  },
  
  // 对话框
  dialog: {
    openFile: (options?: { filters?: Electron.FileFilter[] }): Promise<string[]> =>
      ipcRenderer.invoke('dialog:openFile', options)
  },
  
  // 更新
  update: {
    checkForUpdates: (): Promise<{ hasUpdate: boolean; version?: string }> =>
      ipcRenderer.invoke('update:check'),
    installUpdate: (): Promise<void> =>
      ipcRenderer.invoke('update:install'),
    onUpdateProgress: (callback: (progress: number) => void) => {
      ipcRenderer.on('update:progress', (_, progress) => callback(progress))
    }
  },
  
  // 平台信息
  platform: process.platform,
  versions: {
    node: process.versions.node,
    electron: process.versions.electron,
    chrome: process.versions.chrome
  }
})

// TypeScript 类型声明（供渲染进程使用）
declare global {
  interface Window {
    electronAPI: {
      fs: {
        readFile(path: string): Promise<string>
        writeFile(path: string, content: string): Promise<boolean>
      }
      dialog: {
        openFile(options?: { filters?: Electron.FileFilter[] }): Promise<string[]>
      }
      update: {
        checkForUpdates(): Promise<{ hasUpdate: boolean; version?: string }>
        installUpdate(): Promise<void>
        onUpdateProgress(callback: (progress: number) => void): void
      }
      platform: NodeJS.Platform
      versions: {
        node: string
        electron: string
        chrome: string
      }
    }
  }
}
```

## IPC 通信规范

### 命名约定

| 方向 | 格式 | 示例 |
|------|------|------|
| 渲染 → 主进程 | `<domain>:<action>` | `fs:readFile`, `dialog:openFile` |
| 主进程 → 渲染 | `<domain>:<event>` | `update:progress`, `update:available` |
| 域名 | 功能领域 | `fs`, `dialog`, `update`, `window` |

### 安全原则

1. **永远不信任渲染进程**：所有输入必须校验
2. **最小权限暴露**：只暴露必要的 API
3. **路径白名单**：禁止访问任意文件系统路径
4. **禁止直接执行 shell 命令**

```typescript
// ❌ 错误：直接暴露原始 IPC
contextBridge.exposeInMainWorld('ipc', ipcRenderer)

// ❌ 错误：允许任意路径访问
ipcMain.handle('fs:readAnyFile', (_, path) => fs.readFile(path))

// ✅ 正确：受控的、白名单保护的 API
contextBridge.exposeInMainWorld('electronAPI', {
  fs: { readFile: (path: string) => ipcRenderer.invoke('fs:readFile', path) }
})
ipcMain.handle('fs:readFile', (_, path) => {
  if (!isAllowed(path)) throw new Error('路径不在白名单内')
  return fs.readFile(path)
})
```

## 自动更新规范（update.ts）

```typescript
import { autoUpdater } from 'electron-updater'
import { ipcMain, BrowserWindow } from 'electron'
import log from 'electron-log'

class UpdateManager {
  constructor(private mainWindow: BrowserWindow) {
    this.setupAutoUpdater()
  }
  
  private setupAutoUpdater(): void {
    // 日志配置
    autoUpdater.logger = log
    autoUpdater.autoDownload = false  // 手动触发下载
    autoUpdater.autoInstallOnAppQuit = true
    
    // 更新可用
    autoUpdater.on('update-available', (info) => {
      log.info('发现更新:', info.version)
      this.mainWindow.webContents.send('update:available', {
        version: info.version,
        releaseNotes: info.releaseNotes
      })
    })
    
    // 下载进度
    autoUpdater.on('download-progress', (progress) => {
      this.mainWindow.webContents.send('update:progress', progress.percent)
    })
    
    // 更新已下载
    autoUpdater.on('update-downloaded', () => {
      this.mainWindow.webContents.send('update:downloaded')
    })
    
    // IPC 处理
    ipcMain.handle('update:check', async () => {
      try {
        const result = await autoUpdater.checkForUpdates()
        return {
          hasUpdate: result?.updateInfo?.version !== undefined,
          version: result?.updateInfo?.version
        }
      } catch (error) {
        log.error('检查更新失败:', error)
        return { hasUpdate: false }
      }
    })
    
    ipcMain.handle('update:download', async () => {
      await autoUpdater.downloadUpdate()
    })
    
    ipcMain.handle('update:install', () => {
      autoUpdater.quitAndInstall()
    })
  }
}

export { UpdateManager }
```

## 开发启动脚本（start.js）

```javascript
const { spawn } = require('child_process')
const path = require('path')

// ============================================================================
// 开发环境启动脚本
// 同时启动：
// 1. Vite 前端开发服务器
// 2. FastAPI 后端服务
// 3. Electron 主进程
// ============================================================================

async function start() {
  // 启动后端
  const backend = spawn('python', ['-m', 'app.main'], {
    cwd: path.join(__dirname, '../../backend'),
    stdio: 'inherit',
    env: { ...process.env, PYTHONPATH: path.join(__dirname, '../../backend') }
  })
  
  // 等待后端就绪
  await waitForBackend('http://127.0.0.1:8000/health')
  
  // 启动 Vite
  const vite = spawn('npm', ['run', 'dev'], {
    cwd: path.join(__dirname, '../../frontend'),
    stdio: 'inherit'
  })
  
  // 启动 Electron
  const electron = spawn('npx', ['electron', '.'], {
    cwd: __dirname,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'development' }
  })
  
  // 优雅关闭
  process.on('SIGINT', () => {
    backend.kill()
    vite.kill()
    electron.kill()
    process.exit(0)
  })
}

start()
```

## 构建产物目录

```
electron/
├── dist/              # TypeScript 编译输出
├── out/               # Electron Forge 输出
├── out-make/          # 打包输出
└── release/           # 发布包
```

这些目录已包含在 `.gitignore` 中，不应提交到版本控制。
