/**
 * @file appApi.ts
 * @description 应用级能力抽象层
 *
 * 设计目标：
 * - 封装应用版本、后端状态/端口、项目路径持久化、后端重启等环境相关能力。
 * - Electron 下调用 IPC；Web 下调用后端 HTTP API 或 localStorage。
 * - 业务层（如 useAppBootstrap、设置面板）不再直接访问 window.electronAPI 或 localStorage。
 */

import { isElectron, getElectronAPI } from '@/core/utils/electronDetector'
import apiClient, { updateApiBaseUrl } from '@/core/services/httpClient'
import { logger } from '@/core/utils/logger'

export interface ProjectLaunchConfig {
  configPath?: string
  dataPath?: string
}

export interface ServerStatus {
  pythonReady: boolean
  port: number
}

export interface AppApi {
  /** 当前环境是否支持启动时自动恢复最近项目（Electron 支持，Web 需用户手动选择） */
  readonly canRestoreRecentProject: boolean
  /** 当前环境是否支持把应用语言同步到桌面壳（Electron 支持；Web 无桌面壳原生文案） */
  readonly canSyncAppLocale: boolean
  /** 初始化 API 客户端基础地址（Electron 动态获取端口；Web 使用默认地址） */
  initializeApiClient(): Promise<void>
  /**
   * 获取后端 API 一次性 token（Electron 打包模式经 IPC 下发；Web 返回空串）
   * 渲染进程将其随请求携带 X-Precis-Auth 头，后端据此放行 null Origin 的 CORS
   */
  getApiToken(): Promise<string>
  /** 获取应用版本号 */
  getAppVersion(): Promise<string>
  /** 获取后端服务端口 */
  getBackendPort(): Promise<number>
  /** 获取后端服务状态 */
  getServerStatus(): Promise<ServerStatus>
  /** 加载最近一次打开的项目配置 */
  loadRecentProject(): Promise<ProjectLaunchConfig>
  /** 保存最近一次打开的项目配置 */
  saveRecentProject(paths: ProjectLaunchConfig): Promise<void>
  /** 重启后端服务（Electron 有效） */
  restartBackend(): Promise<boolean>
  /** 同步应用语言到桌面壳，使主进程原生对话框等用户可见文案跟随（Electron 有效，Web 空操作） */
  syncAppLocale(locale: string): void
}

const RECENT_PROJECT_KEY = 'activeProjectPaths'

/**
 * 从 localStorage 读取最近项目配置
 */
function readRecentProjectFromStorage(): ProjectLaunchConfig {
  try {
    const stored = localStorage.getItem(RECENT_PROJECT_KEY)
    if (stored) {
      const parsed = JSON.parse(stored) as Record<string, unknown>
      return {
        configPath: typeof parsed.configPath === 'string' ? parsed.configPath : undefined,
        dataPath: typeof parsed.dataPath === 'string' ? parsed.dataPath : undefined,
      }
    }
  } catch (e) {
    logger.error('[appApi] 读取最近项目配置失败:', e)
  }
  return {}
}

/**
 * 向 localStorage 写入最近项目配置
 */
function writeRecentProjectToStorage(paths: ProjectLaunchConfig): void {
  try {
    if (paths.configPath || paths.dataPath) {
      localStorage.setItem(RECENT_PROJECT_KEY, JSON.stringify(paths))
    } else {
      localStorage.removeItem(RECENT_PROJECT_KEY)
    }
  } catch (e) {
    logger.error('[appApi] 保存最近项目配置失败:', e)
  }
}

/**
 * 从 axios baseURL 解析当前端口号
 */
function parsePortFromBaseURL(): number {
  const baseURL = apiClient.defaults.baseURL || ''
  const match = baseURL.match(/:(\d+)/)
  if (match && match[1]) {
    return parseInt(match[1], 10)
  }
  // 解析不出端口时(如 DEV 模式相对路径 baseURL 为空)返回 0 表示未知,
  // 调用方应通过 appApi.getBackendPort() 从 Electron IPC 获取实际端口
  return 0
}

/**
 * Electron 适配器
 */
class ElectronAppAdapter implements AppApi {
  get canRestoreRecentProject(): boolean {
    return true
  }

  get canSyncAppLocale(): boolean {
    return true
  }

  async initializeApiClient(): Promise<void> {
    try {
      const status = await getElectronAPI().getServerStatus()
      if (status?.port) {
        updateApiBaseUrl(status.port)
      }
    } catch (error) {
      logger.error('[appApi] 初始化 API 地址失败:', error)
    }
  }

  async getApiToken(): Promise<string> {
    try {
      return await getElectronAPI().getApiToken()
    } catch (error) {
      logger.error('[appApi] 获取后端 API token 失败:', error)
      // 拿不到 token 时返回空串：拦截器不注入 X-Precis-Auth，
      // 后端对 localhost Origin 的既有放行不受影响（仅 null Origin 会被拒）
      return ''
    }
  }

  async getAppVersion(): Promise<string> {
    return getElectronAPI().getAppVersion()
  }

  async getBackendPort(): Promise<number> {
    const status = await getElectronAPI().getServerStatus()
    return status.port
  }

  async getServerStatus(): Promise<ServerStatus> {
    return getElectronAPI().getServerStatus()
  }

  async loadRecentProject(): Promise<ProjectLaunchConfig> {
    return getElectronAPI().loadConfig()
  }

  async saveRecentProject(paths: ProjectLaunchConfig): Promise<void> {
    await getElectronAPI().saveConfig(paths.configPath || '', paths.dataPath || '')
  }

  async restartBackend(): Promise<boolean> {
    const result = await getElectronAPI().restartPythonServer()
    return result.ready
  }

  syncAppLocale(locale: string): void {
    try {
      getElectronAPI().setAppLocale(locale)
    } catch (error) {
      logger.error('[appApi] 同步应用语言失败:', error)
    }
  }
}

/**
 * Web 适配器
 */
class WebAppAdapter implements AppApi {
  get canRestoreRecentProject(): boolean {
    return false
  }

  get canSyncAppLocale(): boolean {
    return false
  }

  async initializeApiClient(): Promise<void> {
    // Web 下端口由构建/部署环境决定，无需动态更新
    // 可选择性地探测后端健康状态，但保持静默避免阻塞启动。
    // 注意：健康探测走 /version（/api/latest 前缀下）——后端根路径的 /health
    // 不在 Vite 代理白名单内，经 apiClient 请求会拼出 /api/latest/health 404
    try {
      await apiClient.get('/version', { timeout: 5000 })
    } catch (error) {
      logger.warn('[appApi] Web 模式下后端健康检查失败:', error)
    }
  }

  async getApiToken(): Promise<string> {
    // Web 模式无桌面壳下发 token（后端亦未配置），返回空串
    return ''
  }

  async getAppVersion(): Promise<string> {
    try {
      // apiClient 自带 /api/latest 前缀，此处只写 /version（曾误写全路径致双重前缀 404）
      const { data } = await apiClient.get<{ version: string }>('/version')
      return data.version
    } catch (error) {
      logger.error('[appApi] 获取版本号失败:', error)
      return '1.0.0'
    }
  }

  async getBackendPort(): Promise<number> {
    return parsePortFromBaseURL()
  }

  async getServerStatus(): Promise<ServerStatus> {
    try {
      // 同 initializeApiClient：/version 可达即代表后端就绪（/health 不走代理）
      await apiClient.get<{ version: string }>('/version')
      return {
        pythonReady: true,
        port: await this.getBackendPort(),
      }
    } catch (error) {
      logger.error('[appApi] 获取后端状态失败:', error)
      return {
        pythonReady: false,
        port: await this.getBackendPort(),
      }
    }
  }

  async loadRecentProject(): Promise<ProjectLaunchConfig> {
    return readRecentProjectFromStorage()
  }

  async saveRecentProject(paths: ProjectLaunchConfig): Promise<void> {
    writeRecentProjectToStorage(paths)
  }

  async restartBackend(): Promise<boolean> {
    logger.warn('[appApi] Web 模式下不支持重启后端服务')
    return false
  }

  syncAppLocale(_locale: string): void {
    // Web 模式无桌面壳，原生文案不存在，空操作
  }
}

/**
 * 全局应用能力实例
 */
export const appApi: AppApi = isElectron() ? new ElectronAppAdapter() : new WebAppAdapter()
