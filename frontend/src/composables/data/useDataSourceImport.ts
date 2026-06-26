/**
 * @file useDataSourceImport.ts
 * @description 数据源导入核心逻辑组合式函数
 *
 * 功能概述:
 * - 处理外部文件拖拽放置
 * - 调用统一文件选择能力层（dialogApi）
 * - 扫描文件夹并批量导入数据文件
 * - 处理文件重新加载事件（reload-file-uploaded）
 *
 * 架构设计:
 * - 通过 core/capabilities/dialogApi 统一选择文件/目录，屏蔽 Electron/Web 差异。
 * - 通过 core/capabilities/fileApi.resolveFileReference 将浏览器 File 对象转换为后端可访问路径。
 * - 文件夹导入统一走 dialogApi.selectDirectoryEntries / fileApi.readdirRecursive。
 * - 所有导入最终通过 workspaceStore.addDataSource 持久化。
 */

import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { useGraphStore } from '@/stores/graphStore'
import { logger } from '@/core/utils/logger'
import {
  resolveFileReference,
  isLocalDirectory,
  readLocalDirectoryEntries,
} from '@/core/capabilities/fileApi'
import { dialogApi } from '@/core/capabilities/dialogApi'
import { triggerValidationForNode } from '@/services/constraints/orchestration/globalValidation'
import { normalizePath, getPathBasename } from '@/core/utils/pathNormalization'
import { eventBus } from '@/core/eventBus'
import { toastError, toastSuccess, toastInfo } from '@/core/toast'
import type { ExternalDataSource } from '@/types/graph'

/**
 * 对同一导入批次内的数据源按标准化路径去重
 */
function deduplicateByPath(sources: ExternalDataSource[]): ExternalDataSource[] {
  const seen = new Set<string>()
  const result: ExternalDataSource[] = []
  for (const ds of sources) {
    const key = normalizePath(ds.fileId || ds.localPath || '')
    if (!key) continue
    if (!seen.has(key)) {
      seen.add(key)
      result.push(ds)
    }
  }
  return result
}

/**
 * 过滤掉已在 workspaceStore 中存在的数据源
 */
function filterExistingDataSources(
  sources: ExternalDataSource[],
  workspaceStore: ReturnType<typeof useWorkspaceStore>
): ExternalDataSource[] {
  const existingSources = workspaceStore.getDataSources()
  return sources.filter((ds) => {
    const key = normalizePath(ds.fileId || ds.localPath || '')
    if (!key) return false
    const exists = existingSources.some((existing) => {
      const existingFileId = normalizePath(existing.fileId || '')
      const existingLocalPath = normalizePath(existing.localPath || '')
      return existingFileId === key || existingLocalPath === key
    })
    if (exists) {
      logger.debug('[useDataSourceImport] 跳过已存在的数据源:', key)
    }
    return !exists
  })
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

/**
 * 判断文件名是否为支持的数据文件
 */
const isDataFileName = (fileName: string): boolean => {
  return /\.(xlsx|xls|csv|json)$/i.test(fileName)
}

/**
 * 从文件路径推断 folderPath（取直接父目录名）。
 * 仅对本地真实路径有意义，Web 临时路径返回 undefined。
 */
const inferFolderPath = (filePath: string): string | undefined => {
  // Web 临时路径不计算 folderPath
  if (filePath.includes('precis-web-uploads') || filePath.includes('Temp')) {
    return undefined
  }
  const parentDir = filePath.replace(/[\\/][^\\/]+$/, '')
  const folderName = getPathBasename(parentDir)
  return folderName || undefined
}

/**
 * 构造 ExternalDataSource 对象
 */
const buildExternalDataSource = (
  filePath: string,
  fileName: string,
  fileSize: number,
  folderPath?: string
): ExternalDataSource => ({
  id: `ds_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
  name: fileName,
  fileId: filePath,
  type: getFileTypeFromExtension(fileName),
  status: 'ready',
  lastUsed: new Date().toISOString(),
  addedAt: new Date().toISOString(),
  alias: undefined,
  sourceMode: 'localfile',
  localPath: filePath,
  folderPath,
  isFolder: false,
  size: fileSize,
})

/**
 * 使用数据源导入逻辑
 */
export function useDataSourceImport() {
  const { t } = useI18n()
  const workspaceStore = useWorkspaceStore()
  const graphStore = useGraphStore()

  const isDragOver = ref(false)

  const handleDragOver = (event: DragEvent) => {
    event.preventDefault()
    isDragOver.value = true
  }

  const handleDragLeave = (event: DragEvent) => {
    event.preventDefault()
    isDragOver.value = false
  }

  /**
   * 将导入的数据源批量添加到 workspaceStore
   */
  const addSourcesToWorkspace = async (sources: ExternalDataSource[]) => {
    const uniqueSources = deduplicateByPath(sources)
    const newSources = filterExistingDataSources(uniqueSources, workspaceStore)

    for (const dataSource of newSources) {
      try {
        await workspaceStore.addDataSource(
          dataSource.fileId,
          dataSource.name,
          dataSource.type,
          dataSource.sourceMode,
          dataSource.localPath,
          dataSource.folderPath,
          dataSource.size
        )
        logger.debug(`数据源 ${dataSource.name} 添加成功`)
      } catch (error) {
        logger.error(`添加数据源 ${dataSource.name} 失败:`, error)
        const errorMessage = error instanceof Error ? error.message : String(error)
        toastError(
          t('messages.common.addDataSourceFailed', { name: dataSource.name, error: errorMessage })
        )
      }
    }
  }

  /**
   * 处理外部文件拖拽放置
   */
  const handleExternalFileDrop = async (event: DragEvent) => {
    event.preventDefault()
    isDragOver.value = false

    const files = Array.from(event.dataTransfer?.files || [])
    if (files.length === 0) return

    const fileList: ExternalDataSource[] = []

    for (const file of files) {
      try {
        // Electron 拖拽文件夹：通过 path 属性识别并递归扫描
        if (isLocalDirectory(file)) {
          const electronFile = file as File & { path?: string }
          const folderPath = electronFile.path!
          logger.debug(`[useDataSourceImport] 检测到文件夹拖拽: ${file.name}, 路径: ${folderPath}`)
          try {
            const entries = await readLocalDirectoryEntries(folderPath, [
              '.csv',
              '.xlsx',
              '.xls',
              '.json',
            ])
            for (const entryPath of entries) {
              const entryName = getPathBasename(entryPath) || 'unknown'
              const relativeFolder = inferFolderPath(entryPath)
              fileList.push(buildExternalDataSource(entryPath, entryName, 0, relativeFolder))
            }
          } catch (error) {
            logger.error(`处理文件夹 ${file.name} 失败:`, error)
            toastError(t('messages.common.folderProcessFailed', { name: file.name }))
          }
          continue
        }

        if (!isDataFileName(file.name)) {
          logger.debug(`[useDataSourceImport] 跳过非数据文件: ${file.name}`)
          continue
        }

        const resolved = await resolveFileReference(file)
        const folderPath = inferFolderPath(resolved.path)
        fileList.push(
          buildExternalDataSource(resolved.path, resolved.name, resolved.size, folderPath)
        )
      } catch (error) {
        logger.error(`处理文件 ${file.name} 失败:`, error)
        const errorMessage = error instanceof Error ? error.message : String(error)
        toastError(t('messages.common.fileImportFailed', { name: file.name, error: errorMessage }))
      }
    }

    await addSourcesToWorkspace(fileList)
  }

  /**
   * 处理导入外部文件（点击导入按钮）
   */
  const handleImportFiles = async () => {
    logger.debug('[useDataSourceImport] 使用统一文件选择器')
    const result = await dialogApi.selectFiles({
      title: t('messages.dialog.dataFiles'),
      buttonLabel: t('common.confirm'),
      filters: [
        { name: t('messages.dialog.dataFiles'), extensions: ['xlsx', 'xls', 'csv', 'json'] },
        { name: t('messages.dialog.allFiles'), extensions: ['*'] },
      ],
      multiple: true,
    })

    if (result.canceled || result.filePaths.length === 0) return

    const fileList: ExternalDataSource[] = result.filePaths.map((filePath) => {
      const fileName = getPathBasename(filePath) || 'unknown'
      const folderPath = inferFolderPath(filePath)
      return buildExternalDataSource(filePath, fileName, 0, folderPath)
    })

    await addSourcesToWorkspace(fileList)
    toastSuccess(t('messages.common.importSuccess'))
    eventBus.emit('data-source-changed')
  }

  /**
   * 处理导入文件夹（点击导入文件夹按钮）
   */
  const handleImportFolder = async () => {
    logger.debug('[useDataSourceImport] 使用统一目录选择器')
    const result = await dialogApi.selectDirectoryEntries({
      title: t('messages.dialog.dataFiles'),
      buttonLabel: t('common.confirm'),
      extensions: ['.csv', '.xlsx', '.xls', '.json'],
    })

    if (result.canceled || result.filePaths.length === 0) {
      toastInfo(t('messages.common.noFilesSelected'))
      return
    }

    const fileList: ExternalDataSource[] = result.filePaths.map((filePath) => {
      const fileName = getPathBasename(filePath) || 'unknown'
      const folderPath = inferFolderPath(filePath)
      return buildExternalDataSource(filePath, fileName, 0, folderPath)
    })

    await addSourcesToWorkspace(fileList)
    toastSuccess(t('messages.common.importSuccess'))
    eventBus.emit('data-source-changed')
  }

  /**
   * 处理重新加载文件上传
   */
  const handleReloadFileUploaded = async (event: Event) => {
    const detail = (event as CustomEvent).detail
    const file = detail.file as File
    const nodeId = detail.nodeId
    const sourceName = detail.sourceName

    logger.debug('[useDataSourceImport] 处理重新加载文件:', file.name, 'nodeId:', nodeId)

    try {
      const resolved = await resolveFileReference(file)
      const fileId = resolved.path

      const dataSources = workspaceStore.getDataSources()
      const existingSource = dataSources.find((ds) => ds.name === sourceName)

      if (existingSource) {
        const updatedSource: ExternalDataSource = {
          ...existingSource,
          fileId,
          localPath: fileId,
          name: resolved.name,
          size: resolved.size,
        }
        await workspaceStore.updateDataSource(existingSource.id, updatedSource)
        logger.debug('[useDataSourceImport] 数据源已更新')
      } else {
        const newDataSource = buildExternalDataSource(fileId, resolved.name, resolved.size)
        await workspaceStore.addDataSource(
          newDataSource.fileId,
          newDataSource.name,
          newDataSource.type
        )
        logger.debug('[useDataSourceImport] 新数据源已添加')
      }

      eventBus.emit('data-source-refreshed', {
        nodeId,
        fileId,
        fileName: resolved.name,
      })

      // 延迟触发关联节点的校验
      setTimeout(() => {
        const edges = graphStore.edges
        const connectedSchemaNodes = edges
          .filter((e) => e.source === nodeId && e.targetHandle === 'target-left')
          .map((e) => e.target)

        for (const schemaNodeId of connectedSchemaNodes) {
          logger.debug(`[useDataSourceImport] 触发 SchemaNode 全表校验: ${schemaNodeId}`)
          triggerValidationForNode(
            schemaNodeId,
            graphStore.nodes,
            graphStore.edges,
            graphStore.updateNodeData
          )
        }
      }, 500)
    } catch (error) {
      logger.error('[useDataSourceImport] 处理重新加载文件失败:', error)
      toastError(t('messages.common.reloadFailed'))
    }
  }

  return {
    isDragOver,
    handleDragOver,
    handleDragLeave,
    handleExternalFileDrop,
    handleImportFiles,
    handleImportFolder,
    handleReloadFileUploaded,
  }
}
