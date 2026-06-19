/**
 * @file updateApi.ts
 * @description 自动更新能力抽象层
 *
 * 设计目标：
 * - 为设置面板提供统一的自动更新接口。
 * - Electron 下调用 electron-updater 相关 IPC；Web 下返回不支持状态。
 * - UI 层通过 isSupported 能力探测控制按钮显隐/禁用。
 */

import { isElectron, getElectronAPI } from '@/core/utils/electronDetector'
import { logger } from '@/core/utils/logger'

export interface UpdateConfig {
  sourceType: 'github' | 'custom'
  sourceUrl?: string
  autoCheck: boolean
  autoDownload: boolean
}

export type UpdateConfigInput = Partial<UpdateConfig>

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'update-available'
  | 'update-not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface UpdateState {
  status: UpdateStatus
  version?: string
  releaseDate?: string
  releaseNotes?: string
  progress?: number
  bytesPerSecond?: number
  transferred?: number
  total?: number
  error?: string
}

export interface UpdateOperationResult {
  success: boolean
  error?: string
}

export type UpdateProgressCallback = (state: UpdateState) => void

export interface UpdateApi {
  /** 当前环境是否支持自动更新 */
  readonly isSupported: boolean
  /** 获取当前更新状态 */
  getStatus(): Promise<UpdateState>
  /** 获取更新配置 */
  getConfig(): Promise<UpdateConfig | null>
  /** 保存更新配置 */
  saveConfig(config: UpdateConfigInput): Promise<boolean>
  /** 检查更新 */
  check(): Promise<UpdateState>
  /** 下载更新 */
  download(): Promise<UpdateOperationResult>
  /** 安装更新 */
  install(): Promise<UpdateOperationResult>
  /** 注册状态变化回调（Electron 有效） */
  onProgress(callback: UpdateProgressCallback): () => void
}

/**
 * Electron 适配器：转发到 window.electronAPI.update
 */
class ElectronUpdateAdapter implements UpdateApi {
  get isSupported(): boolean {
    return true
  }

  private progressCallbacks: Set<UpdateProgressCallback> = new Set()
  private pollTimer: number | null = null

  async getStatus(): Promise<UpdateState> {
    return getElectronAPI().update.getStatus()
  }

  async getConfig(): Promise<UpdateConfig | null> {
    try {
      return await getElectronAPI().update.getConfig()
    } catch (error) {
      logger.error('[updateApi] 获取更新配置失败:', error)
      return null
    }
  }

  async saveConfig(config: UpdateConfigInput): Promise<boolean> {
    try {
      return await getElectronAPI().update.saveConfig(config)
    } catch (error) {
      logger.error('[updateApi] 保存更新配置失败:', error)
      return false
    }
  }

  async check(): Promise<UpdateState> {
    this.startPolling()
    return getElectronAPI().update.check()
  }

  async download(): Promise<UpdateOperationResult> {
    this.startPolling()
    return getElectronAPI().update.download()
  }

  async install(): Promise<UpdateOperationResult> {
    return getElectronAPI().update.install()
  }

  onProgress(callback: UpdateProgressCallback): () => void {
    this.progressCallbacks.add(callback)
    this.startPolling()

    return () => {
      this.progressCallbacks.delete(callback)
      if (this.progressCallbacks.size === 0) {
        this.stopPolling()
      }
    }
  }

  private startPolling(): void {
    if (this.pollTimer) return
    this.pollTimer = window.setInterval(async () => {
      try {
        const state = await this.getStatus()
        for (const cb of this.progressCallbacks) {
          cb(state)
        }
      } catch (error) {
        logger.error('[updateApi] 轮询更新状态失败:', error)
      }
    }, 1000)
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      window.clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }
}

/**
 * Web 适配器：自动更新不支持
 */
class WebUpdateAdapter implements UpdateApi {
  get isSupported(): boolean {
    return false
  }

  async getStatus(): Promise<UpdateState> {
    return { status: 'idle' }
  }

  async getConfig(): Promise<UpdateConfig | null> {
    return null
  }

  async saveConfig(): Promise<boolean> {
    return false
  }

  async check(): Promise<UpdateState> {
    return {
      status: 'error',
      error: 'Web mode does not support auto-update',
    }
  }

  async download(): Promise<UpdateOperationResult> {
    return { success: false, error: 'Web mode does not support auto-update' }
  }

  async install(): Promise<UpdateOperationResult> {
    return { success: false, error: 'Web mode does not support auto-update' }
  }

  onProgress(): () => void {
    return () => undefined
  }
}

/**
 * 全局自动更新能力实例
 */
export const updateApi: UpdateApi = isElectron() ? new ElectronUpdateAdapter() : new WebUpdateAdapter()
