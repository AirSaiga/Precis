/**
 * @file electronFileHandler.ts
 * @description Electron 环境文件处理模块
 *
 * 该模块负责处理 Electron 环境下的文件选择和导入逻辑。
 * 使用 IPC 调用主进程的 dialog.showOpenDialog API。
 */

import { logger } from '@/core/utils/logger'
import type { ExternalDataSource } from '@/types/datasource'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { detectFileTypeFromPath } from '@/utils/fileTypeUtils'

export interface ElectronAPI {
  showOpenDialog: (options: {
    title: string
    buttonLabel: string
    filters: Array<{ name: string; extensions: string[] }>
    properties: string[]
  }) => Promise<{ canceled: boolean; filePaths?: string[] }>
  checkFileExists: (filePath: string) => Promise<boolean>
}

let electronApi: ElectronAPI | null = null

export function getElectronAPI(): ElectronAPI | null {
  if (electronApi) return electronApi
  if (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).electronAPI) {
    electronApi = (window as unknown as Record<string, unknown>).electronAPI as ElectronAPI
    return electronApi
  }
  return null
}

export function isElectron(): boolean {
  return (
    typeof window !== 'undefined' && !!(window as unknown as Record<string, unknown>).electronAPI
  )
}

/**
 * 处理 Electron 环境下的文件选择
 *
 * @returns 选中的文件路径数组
 */
export async function selectFilesElectron(): Promise<string[]> {
  const api = getElectronAPI()
  if (!api) {
    logger.error('[ElectronFileHandler] Electron API 不可用')
    throw new Error('Electron API 加载失败')
  }

  const result = await api.showOpenDialog({
    title: '选择数据文件',
    buttonLabel: '选择文件',
    filters: [
      { name: '数据文件', extensions: ['xlsx', 'xls', 'csv', 'json'] },
      { name: '所有文件', extensions: ['*'] },
    ],
    properties: ['openFile', 'multiSelections'],
  })

  if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
    return []
  }

  return result.filePaths
}

/**
 * 将文件路径转换为 ExternalDataSource 对象
 *
 * @param filePath - 文件路径
 * @returns ExternalDataSource 对象
 */
export function createDataSourceFromPath(filePath: string): ExternalDataSource {
  const fileName = filePath.split(/[/\\]/).pop() || 'unknown'
  const fileType = detectFileTypeFromPath(fileName)

  return {
    id: `ds_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    name: fileName,
    fileId: filePath,
    type: fileType === 'unknown' ? 'excel' : fileType,
    status: 'ready' as const,
    lastUsed: new Date().toISOString(),
    addedAt: new Date().toISOString(),
    alias: undefined,
    sourceMode: 'localfile',
    localPath: filePath,
  }
}

/**
 * 处理 Electron 环境下的文件导入
 *
 * @param filePaths - 文件路径数组
 * @returns 导入结果
 */
export async function importFilesElectron(filePaths: string[]): Promise<{
  success: string[]
  failed: Array<{ path: string; error: string }>
}> {
  const success: string[] = []
  const failed: Array<{ path: string; error: string }> = []

  for (const filePath of filePaths) {
    try {
      const dataSource = createDataSourceFromPath(filePath)
      await useWorkspaceStore().addDataSource(
        dataSource.fileId,
        dataSource.name,
        dataSource.type,
        dataSource.sourceMode,
        dataSource.localPath
      )
      success.push(dataSource.name)
    } catch (error) {
      failed.push({
        path: filePath,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return { success, failed }
}
