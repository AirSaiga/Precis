/**
 * @file dialogApi.ts
 * @description 文件/目录选择能力抽象层
 *
 * 设计目标：
 * - 为业务层提供统一的文件/目录选择接口，屏蔽 Electron 原生对话框与 Web 浏览器文件输入的差异。
 * - 返回结构统一为 { canceled: boolean; filePaths: string[] }，filePaths 中的路径必须是后端可访问路径。
 * - UI 层应通过能力探测（canSelectFiles / canSelectDirectoryEntries）决定是否显示选择按钮，而不是判断 isElectron()。
 *
 * Electron 实现：调用 window.electronAPI.showOpenDialog / reselectFile。
 * Web 实现：使用 <input type="file"> / <input webkitdirectory>，选择后上传到后端临时目录，返回临时路径。
 */

import { isElectron, getElectronAPI, type FileFilter } from '@/core/utils/electronDetector'
import { selectFilesInBrowser } from '@/core/utils/fileInput'
import { uploadFile } from '@/core/utils/fileApi'
import { logger } from '@/core/utils/logger'
export interface SelectFilesOptions {
  /** 对话框标题 */
  title?: string
  /** 确认按钮文案 */
  buttonLabel?: string
  /** 文件类型过滤 */
  filters?: FileFilter[]
  /** 是否允许多选 */
  multiple?: boolean
  /** 默认打开路径（Electron 有效） */
  defaultPath?: string
}

export interface SelectDirectoryOptions {
  /** 对话框标题 */
  title?: string
  /** 确认按钮文案 */
  buttonLabel?: string
  /** 是否允许多选 */
  multiple?: boolean
  /** 默认打开路径（Electron 有效） */
  defaultPath?: string
}

export interface SelectDirectoryEntriesOptions {
  /** 对话框标题 */
  title?: string
  /** 确认按钮文案 */
  buttonLabel?: string
  /** 允许的文件扩展名列表，例如 ['.csv', '.xlsx'] */
  extensions?: string[]
  /** 是否允许多选目录 */
  multiple?: boolean
}

export interface SelectResult {
  /** 用户是否取消选择 */
  canceled: boolean
  /** 选中的文件/目录路径列表，已转换为后端可访问路径 */
  filePaths: string[]
}

export interface DialogApi {
  /** 是否支持选择文件 */
  readonly canSelectFiles: boolean
  /** 是否支持选择目录路径（Electron 有效；Web 无法直接选择服务器目录） */
  readonly canSelectDirectory: boolean
  /** 是否支持选择目录并获取其中条目 */
  readonly canSelectDirectoryEntries: boolean
  /** 选择文件 */
  selectFiles(options?: SelectFilesOptions): Promise<SelectResult>
  /** 选择目录路径（Electron 返回目录路径；Web 当前不直接支持，返回空或 canceled） */
  selectDirectory(options?: SelectDirectoryOptions): Promise<SelectResult>
  /** 选择目录并返回目录内所有符合条件的文件路径 */
  selectDirectoryEntries(options?: SelectDirectoryEntriesOptions): Promise<SelectResult>
  /** 重新选择单个文件（用于替换已有数据源） */
  reselectFile(options?: SelectFilesOptions): Promise<SelectResult>
}

/**
 * Electron 适配器：调用原生对话框
 */
class ElectronDialogAdapter implements DialogApi {
  get canSelectFiles(): boolean {
    return true
  }

  get canSelectDirectory(): boolean {
    return true
  }

  get canSelectDirectoryEntries(): boolean {
    return true
  }

  async selectFiles(options?: SelectFilesOptions): Promise<SelectResult> {
    const api = getElectronAPI()
    const properties: string[] = ['openFile']
    if (options?.multiple) {
      properties.push('multiSelections')
    }

    const result = await api.showOpenDialog({
      title: options?.title,
      buttonLabel: options?.buttonLabel,
      filters: options?.filters,
      properties,
    })

    return {
      canceled: result.canceled,
      filePaths: result.filePaths || [],
    }
  }

  async selectDirectory(options?: SelectDirectoryOptions): Promise<SelectResult> {
    const api = getElectronAPI()
    const properties: string[] = ['openDirectory']
    if (options?.multiple) {
      properties.push('multiSelections')
    }

    const result = await api.showOpenDialog({
      title: options?.title,
      buttonLabel: options?.buttonLabel,
      properties,
    })

    return {
      canceled: result.canceled,
      filePaths: result.filePaths || [],
    }
  }

  async selectDirectoryEntries(options?: SelectDirectoryEntriesOptions): Promise<SelectResult> {
    // Electron 下先选择目录，再返回目录路径；业务层可用 fileApi.scanDirectory 递归扫描
    return this.selectDirectory({
      title: options?.title,
      buttonLabel: options?.buttonLabel,
      multiple: options?.multiple,
    })
  }

  async reselectFile(options?: SelectFilesOptions): Promise<SelectResult> {
    const api = getElectronAPI()
    const result = await api.reselectFile({
      title: options?.title,
      buttonLabel: options?.buttonLabel,
      filters: options?.filters,
      properties: ['openFile'],
    })

    return {
      canceled: result.canceled,
      filePaths: result.filePaths || [],
    }
  }
}

/**
 * Web 适配器：使用浏览器文件输入 + 后端上传
 */
class WebDialogAdapter implements DialogApi {
  get canSelectFiles(): boolean {
    return true
  }

  get canSelectDirectory(): boolean {
    // Web 下无法直接选择服务器目录路径
    return false
  }

  get canSelectDirectoryEntries(): boolean {
    // webkitdirectory 在 Chromium/Edge 中支持，Firefox/Safari 支持较差
    if (typeof document === 'undefined') return false
    const input = document.createElement('input')
    return 'webkitdirectory' in input
  }

  async selectFiles(options?: SelectFilesOptions): Promise<SelectResult> {
    const accept =
      options?.filters?.flatMap((filter) => filter.extensions.map((ext) => `.${ext}`)).join(',') ||
      ''

    const files = await selectFilesInBrowser({
      accept,
      multiple: options?.multiple ?? true,
    })

    if (files.length === 0) {
      return { canceled: true, filePaths: [] }
    }

    const filePaths = await this.uploadFiles(files)
    return { canceled: false, filePaths }
  }

  async selectDirectory(): Promise<SelectResult> {
    // Web 下无法直接获取服务器目录路径；业务层应使用手动输入或其他方式
    logger.warn(
      '[dialogApi] Web 下不支持直接选择目录路径，请使用 selectDirectoryEntries 或手动输入'
    )
    return { canceled: true, filePaths: [] }
  }

  async selectDirectoryEntries(options?: SelectDirectoryEntriesOptions): Promise<SelectResult> {
    if (!this.canSelectDirectoryEntries) {
      logger.warn('[dialogApi] 当前浏览器不支持目录选择')
      return { canceled: true, filePaths: [] }
    }

    const files = await selectFilesInBrowser({ directory: true })
    if (files.length === 0) {
      return { canceled: true, filePaths: [] }
    }

    const filteredFiles = this.filterFilesByExtension(files, options?.extensions)
    if (filteredFiles.length === 0) {
      return { canceled: true, filePaths: [] }
    }

    const filePaths = await this.uploadFiles(filteredFiles)
    return { canceled: false, filePaths }
  }

  async reselectFile(options?: SelectFilesOptions): Promise<SelectResult> {
    return this.selectFiles({ ...options, multiple: false })
  }

  private filterFilesByExtension(files: File[], extensions?: string[]): File[] {
    if (!extensions || extensions.length === 0) return files
    return files.filter((file) => {
      const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
      return extensions.some((e) => e.toLowerCase() === ext)
    })
  }

  private async uploadFiles(files: File[]): Promise<string[]> {
    return Promise.all(
      files.map(async (file) => {
        const result = await uploadFile(file)
        return result.temp_path
      })
    )
  }
}

/**
 * 全局文件/目录选择能力实例
 */
export const dialogApi: DialogApi = isElectron()
  ? new ElectronDialogAdapter()
  : new WebDialogAdapter()
