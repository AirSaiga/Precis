/**
 * @file useDataSourceFileOps.ts
 * @description 数据源文件操作组合式函数
 *
 * 功能概述:
 * - 打开本地数据源文件（Electron 模式）
 * - 重新选择数据源文件（路径变更时）
 * - 移除单个数据源
 * - 清空所有数据源
 *
 * 架构设计:
 * - 仅在 Electron 环境下执行本地文件操作
 * - 文件不存在时提供重新选择对话框
 * - 所有操作通过 workspaceStore 进行持久化
 *
 * 输入示例:
 *   dataSource: { id: 'ds_xxx', name: 'data.xlsx', sourceMode: 'localfile', localPath: '...' }
 *
 * 输出示例:
 *   调用系统默认程序打开文件，或更新 workspaceStore 中的数据源状态
 */

import { useI18n } from 'vue-i18n'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { useGlobalConfirm } from '@/composables/useGlobalConfirm'
import { toastError, toastSuccess, toastInfo } from '@/core/toast'
import { logger } from '@/core/utils/logger'
import { isElectron, getElectronAPI } from '@/core/utils/electronDetector'
import type { ExternalDataSource } from '@/types/graph'

/**
 * 使用数据源文件操作
 *
 * @returns 文件操作处理器
 */
export function useDataSourceFileOps() {
  const { t } = useI18n()
  const workspaceStore = useWorkspaceStore()
  const isElectronEnv = isElectron()

  const { showConfirm } = useGlobalConfirm()

  /**
   * 打开本地数据源文件
   *
   * 在 Electron 模式下，通过本地路径打开已保存的数据源，
   * 验证文件是否存在，如果文件无效则提供重新选择文件的功能。
   *
   * @param dataSource - 要打开的数据源对象
   */
  const handleOpenDataSource = async (dataSource: ExternalDataSource) => {
    // 1. 检查是否为本地文件模式
    if (dataSource.sourceMode !== 'localfile' || !dataSource.localPath) {
      logger.warn('[useDataSourceFileOps] 打开失败：非本地文件模式')
      toastError(t('messages.common.filePathRequired'))
      return
    }

    // 2. 获取 Electron API
    const api = getElectronAPI()
    if (!api) {
      logger.error('[useDataSourceFileOps] 打开失败：Electron API 不可用')
      toastError(t('messages.common.electronRequired'))
      return
    }

    try {
      // 3. 使用系统默认程序打开文件
      logger.debug('[useDataSourceFileOps] 尝试用系统程序打开文件:', dataSource.localPath)
      const result = await api.openFile(dataSource.localPath)

      if (result.success) {
        logger.debug('[useDataSourceFileOps] 文件已用系统程序打开:', dataSource.name)
      } else {
        // 打开失败，可能是文件不存在
        logger.warn('[useDataSourceFileOps] 打开文件失败:', result.error)
        const shouldReselect = await showConfirm({
          title: t('common.confirmDialog.title'),
          message:
            `无法打开文件：${dataSource.name}\n\n` +
            `错误信息：${result.error || '未知错误'}\n\n` +
            `可能的原因：\n` +
            `• 文件已被移动或删除\n` +
            `• 路径已变更\n` +
            `• 没有关联的程序打开此文件类型\n\n` +
            `是否重新选择文件？`,
          confirmText: t('common.confirm'),
          cancelText: t('common.cancel'),
          type: 'warning',
        })

        if (shouldReselect) {
          await handleReselectFile(dataSource)
        } else {
          // 用户取消，更新状态为 missing
          await workspaceStore.updateDataSourceStatus(dataSource.id, false, '文件未找到或路径无效')
        }
      }
    } catch (error) {
      logger.error('[useDataSourceFileOps] 打开文件失败:', error)
      const errorMessage = error instanceof Error ? error.message : String(error)
      toastError(`打开文件失败：${errorMessage || '未知错误'}\n\n请尝试重新选择文件。`)
    }
  }

  /**
   * 重新选择数据源文件
   *
   * 当原有文件路径无效时，让用户重新选择文件并更新数据源信息。
   *
   * @param oldDataSource - 要替换的旧数据源
   */
  const handleReselectFile = async (oldDataSource: ExternalDataSource) => {
    const api = getElectronAPI()
    if (!api) {
      logger.error('[useDataSourceFileOps] 重新选择失败：Electron API 不可用')
      toastError(t('messages.common.cannotReselectFile'))
      return
    }

    try {
      // 打开文件选择对话框
      const result = await api.reselectFile({
        title: '重新选择数据文件',
        buttonLabel: '确认选择',
        filters: [
          { name: '数据文件', extensions: ['xlsx', 'xls', 'csv'] },
          { name: '所有文件', extensions: ['*'] },
        ],
        properties: ['openFile'],
      })

      if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        logger.debug('[useDataSourceFileOps] 用户取消重新选择')
        return
      }

      // 获取新选择的文件路径
      const newFilePath = result.filePaths[0]
      if (!newFilePath) {
        logger.debug('[useDataSourceFileOps] 未获取到文件路径')
        return
      }
      // 使用字符串操作提取文件名（兼容前端环境）
      const fileName = newFilePath.split(/[/\\]/).pop() || newFilePath
      const fileType = getFileTypeFromExtension(fileName)

      logger.debug('[useDataSourceFileOps] 用户重新选择了文件:', newFilePath)

      // 更新数据源
      const updatedDataSource: ExternalDataSource = {
        ...oldDataSource,
        name: fileName,
        fileId: newFilePath,
        localPath: newFilePath,
        sourceMode: 'localfile',
        status: 'ready',
      }

      await workspaceStore.updateDataSource(oldDataSource.id, updatedDataSource)
      logger.debug('[useDataSourceFileOps] 数据源已更新:', updatedDataSource.name)

      toastSuccess(`文件已更新：${fileName}\n\n您现在可以将此数据源拖拽到画布中使用。`)
    } catch (error) {
      logger.error('[useDataSourceFileOps] 重新选择文件失败:', error)
      const errorMessage = error instanceof Error ? error.message : String(error)
      toastError(`重新选择文件失败：${errorMessage || '未知错误'}`)
    }
  }

  /**
   * 处理清空所有数据源
   *
   * 显示确认对话框，确认后删除所有数据源
   */
  const handleClearAll = async () => {
    const dataSources = workspaceStore.getDataSources()
    if (!dataSources || dataSources.length === 0) return

    // 确认对话框
    const confirmed = await showConfirm({
      title: t('common.confirmDialog.title'),
      message: t('messages.confirmClearAll', { count: dataSources.length }),
      confirmText: t('common.confirm'),
      cancelText: t('common.cancel'),
      type: 'warning',
    })
    if (confirmed) {
      try {
        await workspaceStore.clearAllDataSources()
      } catch (error) {
        logger.error('清空数据源失败:', error)
        toastError(t('messages.common.clearFailed'))
      }
    }
  }

  /**
   * 处理移除单个数据源
   *
   * @param dataSourceId - 要移除的数据源 ID
   */
  const handleRemoveDataSource = async (dataSourceId: string) => {
    try {
      await workspaceStore.removeDataSource(dataSourceId)
    } catch (error) {
      logger.error('移除数据源失败:', error)
      toastError(t('messages.common.removeFailed'))
    }
  }

  /**
   * 从文件名获取文件类型
   *
   * @param fileName - 文件名
   * @returns 文件类型：'excel'、'csv' 或 'json'
   */
  const getFileTypeFromExtension = (fileName: string): 'excel' | 'csv' | 'json' => {
    const ext = fileName.toLowerCase().split('.').pop()
    if (ext === 'xlsx' || ext === 'xls') return 'excel'
    if (ext === 'csv') return 'csv'
    if (ext === 'json') return 'json'
    return 'excel'
  }

  return {
    handleOpenDataSource,
    handleReselectFile,
    handleClearAll,
    handleRemoveDataSource,
    getFileTypeFromExtension,
    isElectronEnv,
  }
}
