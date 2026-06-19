/**
 * @file shellApi.ts
 * @description 打开文件/目录/外部链接能力抽象层
 *
 * 设计目标：
 * - 为业务层提供统一的"用系统程序打开本地文件"接口。
 * - Electron 下使用 shell.openPath / openInEditor；Web 下降级为下载或复制路径。
 * - UI 层应通过能力探测（canOpenLocalFile / canOpenInEditor）控制按钮显隐。
 */

import { isElectron, getElectronAPI } from '@/core/utils/electronDetector'
import { getFileDownloadUrl } from '@/core/utils/fileApi'
import { logger } from '@/core/utils/logger'

export interface OpenResult {
  success: boolean
  error?: string
}

export interface ShellApi {
  /** 是否支持用系统程序打开本地文件 */
  readonly canOpenLocalFile: boolean
  /** 是否支持用编辑器打开本地文件 */
  readonly canOpenInEditor: boolean
  /** 用系统默认程序打开文件（Electron）或下载文件（Web） */
  openFile(path: string): Promise<OpenResult>
  /** 用编辑器打开文件；Web 下降级为复制路径 */
  openInEditor(path: string): Promise<OpenResult>
  /** 在外部浏览器打开 URL */
  openExternal(url: string): void
}

/**
 * Electron 适配器：调用原生 shell 能力
 */
class ElectronShellAdapter implements ShellApi {
  get canOpenLocalFile(): boolean {
    return true
  }

  get canOpenInEditor(): boolean {
    return true
  }

  async openFile(path: string): Promise<OpenResult> {
    const api = getElectronAPI()
    return api.openFile(path)
  }

  async openInEditor(path: string): Promise<OpenResult> {
    const api = getElectronAPI() as ElectronAPI & {
      openInEditor?: (filePath: string) => Promise<{ success: boolean; error?: string }>
    }
    if (api.openInEditor) {
      return api.openInEditor(path)
    }
    // 若 preload 未暴露 openInEditor，降级为 openFile
    return api.openFile(path)
  }

  openExternal(url: string): void {
    window.open(url, '_blank')
  }
}

/**
 * Web 适配器：下载或复制路径
 */
class WebShellAdapter implements ShellApi {
  get canOpenLocalFile(): boolean {
    // Web 下可以通过下载方式让用户获得文件
    return true
  }

  get canOpenInEditor(): boolean {
    // Web 下无法直接打开编辑器，只能复制路径
    return false
  }

  async openFile(path: string): Promise<OpenResult> {
    try {
      const url = getFileDownloadUrl(path)
      window.open(url, '_blank')
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('[shellApi] Web 下载文件失败:', error)
      return { success: false, error: message }
    }
  }

  async openInEditor(path: string): Promise<OpenResult> {
    try {
      await navigator.clipboard.writeText(path)
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('[shellApi] 复制路径到剪贴板失败:', error)
      return { success: false, error: message }
    }
  }

  openExternal(url: string): void {
    window.open(url, '_blank')
  }
}

/**
 * 全局 shell 能力实例
 */
export const shellApi: ShellApi = isElectron() ? new ElectronShellAdapter() : new WebShellAdapter()
