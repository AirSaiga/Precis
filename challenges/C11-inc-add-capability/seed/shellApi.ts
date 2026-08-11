/**
 * Shell 能力抽象（C11 seed —— 参考模板）。
 *
 * Precis 的能力层把 Electron/Web 差异封装成统一接口：
 *   - interface 定义能力契约（含 canXxx 只读探测属性）
 *   - ElectronXxxAdapter：Electron 环境实现（用 window.electronAPI）
 *   - WebXxxAdapter：Web 环境回退实现
 *   - 导出单例：按环境选适配器
 *
 * 业务组件通过能力探测属性（如 shellApi.canOpenLocalFile）控制 UI。
 * AGENTS.md："业务组件禁止直接访问 window.electronAPI"。
 */

interface ShellApi {
  /** 是否能打开本地文件（Electron 环境 true，Web 环境 false） */
  readonly canOpenLocalFile: boolean
  openPath(fullPath: string): Promise<string>
}

class ElectronShellAdapter implements ShellApi {
  readonly canOpenLocalFile = true
  async openPath(fullPath: string): Promise<string> {
    return window.electronAPI.shell.openPath(fullPath)
  }
}

class WebShellAdapter implements ShellApi {
  readonly canOpenLocalFile = false
  async openPath(_fullPath: string): Promise<string> {
    throw new Error('Web 环境不支持 openPath')
  }
}

function isElectron(): boolean {
  return typeof window !== 'undefined' && !!(window as { electronAPI?: unknown }).electronAPI
}

export const shellApi: ShellApi = isElectron() ? new ElectronShellAdapter() : new WebShellAdapter()
