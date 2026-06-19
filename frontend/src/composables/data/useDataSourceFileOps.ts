/**
 * @file useDataSourceFileOps.ts
 * @description 数据源文件操作组合式函数
 *
 * 功能概述:
 * - 打开本地数据源文件
 * - 重新选择数据源文件（路径变更时）
 * - 移除单个数据源
 * - 清空所有数据源
 *
 * 架构设计:
 * - 通过 core/capabilities/shellApi 统一打开文件，屏蔽 Electron/Web 差异。
 * - 通过 core/capabilities/dialogApi 重新选择文件。
 * - 所有操作通过 workspaceStore 进行持久化。
 */

import { useI18n } from 'vue-i18n'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { useGlobalConfirm } from '@/composables/useGlobalConfirm'
import { toastError, toastSuccess } from '@/core/toast'
import { logger } from '@/core/utils/logger'
import { shellApi } from '@/core/capabilities/shellApi'
import { dialogApi } from '@/core/capabilities/dialogApi'
import type { ExternalDataSource } from '@/types/graph'

/**
 * 使用数据源文件操作
 */
export function useDataSourceFileOps() {
  const { t } = useI18n()
  const workspaceStore = useWorkspaceStore()
  const { showConfirm } = useGlobalConfirm()

  /**
   * 打开数据源文件
   *
   * Electron 下使用系统默认程序打开；Web 下触发浏览器下载。
   */
  const handleOpenDataSource = async (dataSource: ExternalDataSource) => {
    if (dataSource.sourceMode !== 'localfile' || !dataSource.localPath) {
      logger.warn('[useDataSourceFileOps] 打开失败：非本地文件模式')
      toastError(t('messages.common.filePathRequired'))
      return
    }

    const result = await shellApi.openFile(dataSource.localPath)

    if (result.success) {
      logger.debug('[useDataSourceFileOps] 文件已打开:', dataSource.name)
      return
    }

    // 打开失败，询问是否重新选择
    logger.warn('[useDataSourceFileOps] 打开文件失败:', result.error)
    const shouldReselect = await showConfirm({
      title: t('common.confirmDialog.title'),
      message: t('messages.confirmReselectFile', {
        name: dataSource.name,
        error: result.error || t('common.unknownError'),
      }),
      confirmText: t('common.confirm'),
      cancelText: t('common.cancel'),
      type: 'warning',
    })

    if (shouldReselect) {
      await handleReselectFile(dataSource)
    } else {
      await workspaceStore.updateDataSourceStatus(dataSource.id, false, '文件未找到或路径无效')
    }
  }

  /**
   * 重新选择数据源文件
   */
  const handleReselectFile = async (oldDataSource: ExternalDataSource) => {
    const result = await dialogApi.reselectFile({
      title: t('messages.dialog.reselectFileTitle'),
      buttonLabel: t('messages.dialog.reselectFileButton'),
      filters: [
        { name: t('messages.dialog.dataFiles'), extensions: ['xlsx', 'xls', 'csv', 'json'] },
        { name: t('messages.dialog.allFiles'), extensions: ['*'] },
      ],
    })

    if (result.canceled || result.filePaths.length === 0) {
      logger.debug('[useDataSourceFileOps] 用户取消重新选择')
      return
    }

    const newFilePath = result.filePaths[0]
    if (!newFilePath) {
      logger.debug('[useDataSourceFileOps] 未获取到文件路径')
      return
    }

    const fileName = newFilePath.split(/[/\\]/).pop() || newFilePath
    const fileType = getFileTypeFromExtension(fileName)

    logger.debug('[useDataSourceFileOps] 用户重新选择了文件:', newFilePath)

    const updatedDataSource: ExternalDataSource = {
      ...oldDataSource,
      name: fileName,
      fileId: newFilePath,
      localPath: newFilePath,
      sourceMode: 'localfile',
      status: 'ready',
      type: fileType,
    }

    await workspaceStore.updateDataSource(oldDataSource.id, updatedDataSource)
    logger.debug('[useDataSourceFileOps] 数据源已更新:', updatedDataSource.name)
    toastSuccess(t('messages.common.fileUpdated', { name: fileName }))
  }

  /**
   * 处理清空所有数据源
   */
  const handleClearAll = async () => {
    const dataSources = workspaceStore.getDataSources()
    if (!dataSources || dataSources.length === 0) return

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
  }
}
