/**
 * @file useDataSourceImport.ts
 * @description 数据源导入核心逻辑组合式函数
 *
 * 功能概述:
 * - 处理外部文件拖拽放置（Electron / 浏览器双模式）
 * - 调用系统文件选择对话框（Electron 模式）
 * - 浏览器环境下使用标准 input[type=file] 选择文件
 * - 扫描文件夹并批量导入数据文件
 * - 处理文件重新加载事件（reload-file-uploaded）
 *
 * 架构设计:
 * - Electron 模式：使用 IPC 调用主进程 dialog API，直接获取本地路径
 * - 浏览器模式：使用标准文件输入，文件名作为 fileId
 * - 文件夹导入时递归扫描并计算相对路径
 * - 所有导入最终通过 workspaceStore.addDataSource 持久化
 *
 * 输入示例:
 *   DragEvent.dataTransfer.files
 *   Electron dialog 返回的 filePaths
 *
 * 输出示例:
 *   workspaceStore.addDataSource(...) 调用序列
 */

import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { useGraphStore } from '@/stores/graphStore'
import { logger } from '@/core/utils/logger'
import { isElectron, getElectronAPI } from '@/core/utils/electronDetector'
import { platformDetector } from '@/features/keyboard/platform'
import { triggerValidationForNode } from '@/services/constraints/orchestration/globalValidation'
import { normalizePath, getPathBasename } from '@/core/utils/pathNormalization'
import { eventBus } from '@/core/eventBus'
import { toastError, toastSuccess, toastInfo } from '@/core/toast'
import type { ExternalDataSource } from '@/types/graph'

/**
 * 对同一导入批次内的数据源按标准化路径去重
 *
 * 保留首次出现的条目，丢弃后续同路径重复项，
 * 防止同路径同名文件在同一次导入中产生多条记录。
 *
 * @param sources - 待去重的数据源数组
 * @returns 去重后的数据源数组
 */
function deduplicateByPath(sources: ExternalDataSource[]): ExternalDataSource[] {
  const seen = new Set<string>()
  const result: ExternalDataSource[] = []
  for (const ds of sources) {
    const key = normalizePath(ds.fileId || ds.localPath || '')
    if (!key) continue // 无法识别路径的条目直接跳过，与 electronFileHandler 行为一致
    if (!seen.has(key)) {
      seen.add(key)
      result.push(ds)
    }
  }
  return result
}

/**
 * 过滤掉已在 workspaceStore 中存在的数据源
 *
 * 使用与 workspaceStore.addDataSource 相同的标准化路径比较逻辑，
 * 在批量导入前预先剔除已存在的文件，避免并发调用 addDataSource 时
 * 因竞态条件导致重复录入。
 *
 * @param sources - 待过滤的数据源数组
 * @param workspaceStore - workspaceStore 实例
 * @returns 过滤后的新数据源数组
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
 * 使用数据源导入逻辑
 *
 * @returns 导入相关状态和方法
 */
export function useDataSourceImport() {
  const { t } = useI18n()
  const workspaceStore = useWorkspaceStore()
  const graphStore = useGraphStore()

  /**
   * 拖拽悬停状态标志
   */
  const isDragOver = ref(false)

  /**
   * 处理拖拽悬停事件
   */
  const handleDragOver = (event: DragEvent) => {
    event.preventDefault()
    isDragOver.value = true
  }

  /**
   * 处理拖拽离开事件
   */
  const handleDragLeave = (event: DragEvent) => {
    event.preventDefault()
    isDragOver.value = false
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
   * 处理外部文件拖拽放置
   *
   * @param event - 拖拽放置事件对象
   */
  const handleExternalFileDrop = async (event: DragEvent) => {
    event.preventDefault()
    isDragOver.value = false

    const files = Array.from(event.dataTransfer?.files || [])
    const fileList: ExternalDataSource[] = []

    for (const file of files) {
      // 检测是否为文件夹（无扩展名且有路径）
      const electronFile = file as File & { path?: string }
      const localPath = electronFile.path
      const hasExtension = file.name.match(/\.(xlsx|xls|csv)$/i)

      // 如果文件无扩展名但有路径，可能是文件夹
      if (localPath && !hasExtension) {
        logger.debug(`[useDataSourceImport] 检测到文件夹拖拽: ${file.name}, 路径: ${localPath}`)
        try {
          await handleFolderImport(localPath)
          continue
        } catch (error) {
          logger.error(`处理文件夹 ${file.name} 失败:`, error)
          toastError(`处理文件夹 ${file.name} 失败`)
          continue
        }
      }

      if (hasExtension) {
        try {
          logger.debug(`[useDataSourceImport] 处理拖拽文件 ${file.name}`)

          const filePath = electronFile.path || file.name
          const dataSource: ExternalDataSource = {
            id: `ds_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            name: file.name,
            fileId: filePath,
            type: getFileTypeFromExtension(file.name),
            status: 'ready',
            lastUsed: new Date().toISOString(),
            addedAt: new Date().toISOString(),
            alias: undefined,
            sourceMode: 'localfile',
            localPath: filePath,
            size: file.size,
          }
          fileList.push(dataSource)
        } catch (error) {
          logger.error(`处理文件 ${file.name} 失败:`, error)
          toastError(`处理文件 ${file.name} 失败，请确保文件路径有效`)
        }
      }
    }

    const uniqueFileList = deduplicateByPath(fileList)
    // 与 workspaceStore 中已有数据源交叉去重，避免重复录入
    const newFileList = filterExistingDataSources(uniqueFileList, workspaceStore)

    for (const dataSource of newFileList) {
      try {
        await workspaceStore.addDataSource(
          dataSource.fileId,
          dataSource.name,
          dataSource.type,
          dataSource.sourceMode,
          dataSource.localPath,
          undefined,
          dataSource.size
        )
        logger.debug(`数据源 ${dataSource.name} 添加成功`)
      } catch (error) {
        logger.error(`添加数据源 ${dataSource.name} 失败:`, error)
        const errorMessage = error instanceof Error ? error.message : String(error)
        toastError(`添加数据源 ${dataSource.name} 失败: ${errorMessage}`)
      }
    }
  }

  /**
   * 处理导入外部文件
   *
   * 根据当前环境选择对应的文件选择方式
   */
  const handleImportFiles = async () => {
    logger.debug('[useDataSourceImport] 使用系统文件选择器')
    await handleElectronFileSelect()
  }

  /**
   * Electron 环境下的文件选择
   */
  const handleElectronFileSelect = async () => {
    try {
      const api = getElectronAPI()
      if (!api) {
        logger.error('[useDataSourceImport] Electron API 不可用')
        logger.warn('[useDataSourceImport] 可能原因:')
        logger.warn('  1. preload 脚本未正确加载')
        logger.warn('  2. contextBridge 未暴露 electronAPI')
        logger.warn('  3. BrowserWindow webPreferences 配置问题')

        if (!isElectron()) {
          toastError(t('messages.common.electronNotDetected'))
        } else {
          toastError(t('messages.common.electronApiFailed'))
        }
        return
      }

      logger.debug('[useDataSourceImport] Electron API 对象:', api)
      logger.debug('[useDataSourceImport] API 方法列表:', Object.keys(api))
      logger.debug('[useDataSourceImport] scanDirectory 方法是否存在:', typeof api.scanDirectory)

      logger.debug('[useDataSourceImport] 开始打开文件选择对话框...')
      const result = await api.showOpenDialog({
        title: '选择数据文件或文件夹',
        buttonLabel: '选择',
        filters: [
          { name: '数据文件', extensions: ['xlsx', 'xls', 'csv', 'json'] },
          { name: '所有文件', extensions: ['*'] },
        ],
        properties: ['openFile', 'openDirectory', 'multiSelections'],
      })
      logger.debug('[useDataSourceImport] 文件选择结果:', result)

      if (result.canceled) {
        logger.debug('[useDataSourceImport] 用户取消文件选择')
        return
      }

      if (!result.filePaths || result.filePaths.length === 0) {
        logger.error('[useDataSourceImport] 文件路径为空:', result)
        toastError(t('messages.common.noFilesSelected'))
        return
      }

      if (!result.canceled && result.filePaths.length > 0) {
        const fileList: ExternalDataSource[] = []

        for (const filePath of result.filePaths) {
          const fileName = getPathBasename(filePath) || 'unknown'

          // 检查是否是文件夹（通过文件扩展名判断，无扩展名可能是文件夹）
          const hasExtension = /\.(xlsx|xls|csv|json)$/i.test(fileName)

          if (!hasExtension) {
            // 选择的是文件夹，调用 scanDirectory 扫描文件夹
            logger.debug('[useDataSourceImport] 检测到文件夹选择:', filePath)
            try {
              const filesInFolder = await api.scanDirectory(filePath, [
                '.csv',
                '.xlsx',
                '.xls',
                '.json',
              ])
              logger.debug('[useDataSourceImport] 文件夹扫描结果:', filesInFolder)

              for (const scannedFilePath of filesInFolder) {
                const scannedFileName = getPathBasename(scannedFilePath) || 'unknown'
                // 获取导入的根文件夹名称作为 folderPath 的前缀
                const rootFolderName = getPathBasename(filePath)
                // 计算相对于导入文件夹根目录的路径
                let relativePath = scannedFilePath.replace(filePath, '').replace(/^[/\\]/, '')
                // 如果 relativePath 等于文件名，说明文件在文件夹根目录，设置为根文件夹名称
                if (relativePath === scannedFileName && rootFolderName) {
                  relativePath = rootFolderName
                } else if (relativePath && rootFolderName) {
                  // 文件在子文件夹中，添加根文件夹前缀，使用跨平台路径分隔符
                  const sep = platformDetector.isWindows() ? '\\' : '/'
                  relativePath = rootFolderName + sep + relativePath
                }
                logger.debug(
                  '[useDataSourceImport] 扫描文件:',
                  scannedFilePath,
                  '-> relativePath:',
                  relativePath
                )

                const dataSource: ExternalDataSource = {
                  id: `ds_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                  name: scannedFileName,
                  fileId: scannedFilePath,
                  type: getFileTypeFromExtension(scannedFileName),
                  status: 'ready',
                  lastUsed: new Date().toISOString(),
                  addedAt: new Date().toISOString(),
                  alias: undefined,
                  sourceMode: 'localfile',
                  localPath: scannedFilePath,
                  folderPath: relativePath,
                  isFolder: false,
                }
                fileList.push(dataSource)
              }

              if (filesInFolder.length === 0) {
                logger.warn('[useDataSourceImport] 文件夹中没有找到数据文件:', filePath)
                toastError(`文件夹 "${fileName}" 中没有找到数据文件 (.xlsx, .xls, .csv)`)
              }
            } catch (scanError) {
              logger.error('[useDataSourceImport] 扫描文件夹失败:', scanError)
              toastError(`扫描文件夹失败: ${fileName}`)
            }
          } else {
            // 选择的是单个文件
            const dataSource: ExternalDataSource = {
              id: `ds_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
              name: fileName,
              fileId: filePath,
              type: getFileTypeFromExtension(fileName),
              status: 'ready',
              lastUsed: new Date().toISOString(),
              addedAt: new Date().toISOString(),
              alias: undefined,
              sourceMode: 'localfile',
              localPath: filePath,
            }
            fileList.push(dataSource)
          }
        }

        const uniqueFileList2 = deduplicateByPath(fileList)
        // 与 workspaceStore 中已有数据源交叉去重，避免重复录入
        const newFileList2 = filterExistingDataSources(uniqueFileList2, workspaceStore)

        for (const dataSource of newFileList2) {
          try {
            await workspaceStore.addDataSource(
              dataSource.fileId,
              dataSource.name,
              dataSource.type,
              dataSource.sourceMode,
              dataSource.localPath,
              dataSource.folderPath
            )
            logger.debug(`数据源 ${dataSource.name} 添加成功，folderPath: ${dataSource.folderPath}`)
          } catch (error) {
            logger.error(`添加数据源 ${dataSource.name} 失败:`, error)
            const errorMessage = error instanceof Error ? error.message : String(error)
            toastError(`添加数据源 ${dataSource.name} 失败: ${errorMessage}`)
          }
        }
      }
    } catch (error) {
      logger.error('[useDataSourceImport] Electron 文件选择失败:', error)
      logger.error('[useDataSourceImport] 错误类型:', typeof error)

      let errorMessage = '未知错误'
      let userMessage = '文件选择失败，请稍后重试'

      if (error instanceof Error) {
        errorMessage = error.message
        logger.error('[useDataSourceImport] 错误堆栈:', error.stack)

        if (errorMessage.includes('ipcRenderer')) {
          userMessage = 'IPC 通信失败，请尝试重启应用'
        } else if (errorMessage.includes('dialog')) {
          userMessage = '文件对话框打开失败，请检查应用权限'
        } else if (errorMessage.includes('net::ERR')) {
          userMessage = '网络请求失败，请检查网络连接'
        } else {
          userMessage = `文件选择失败: ${errorMessage}`
        }
      } else {
        errorMessage = String(error)
        userMessage = `文件选择失败: ${errorMessage}`
      }

      toastError(userMessage)
      logger.warn('[useDataSourceImport] 调试建议:')
      logger.warn('  1. 检查开发者工具控制台是否有其他错误')
      logger.warn('  2. 确认 preload 脚本已正确加载')
      logger.warn('  3. 尝试重启应用')
    }
  }

  /**
   * 处理文件夹导入
   *
   * @param folderPath - 要导入的文件夹路径
   */
  const handleFolderImport = async (folderPath: string): Promise<void> => {
    const api = getElectronAPI()

    if (!api) {
      logger.error('[useDataSourceImport] 文件夹导入失败：Electron API 不可用')
      toastError(t('messages.common.electronApiFailed'))
      return
    }

    if (!folderPath || typeof folderPath !== 'string') {
      logger.error('[useDataSourceImport] 文件夹导入失败：无效的文件夹路径')
      toastError(t('messages.messages.invalidFolderPath'))
      return
    }

    logger.debug('[useDataSourceImport] 开始导入文件夹:', folderPath)

    try {
      const filesInFolder = await api.scanDirectory(folderPath, ['.csv', '.xlsx', '.xls', '.json'])
      logger.debug('[useDataSourceImport] 文件夹扫描结果:', filesInFolder)

      if (filesInFolder.length === 0) {
        toastError(`文件夹中没有找到数据文件 (.xlsx, .xls, .csv)`)
        return
      }

      const folderName = getPathBasename(folderPath) || 'folder'
      let successCount = 0
      let failCount = 0

      // 批次级路径去重：过滤 scanDirectory 可能返回的重复路径
      const seen = new Set<string>()
      const uniqueFiles = filesInFolder.filter((p) => {
        const key = normalizePath(p)
        if (!key || seen.has(key)) return false
        seen.add(key)
        return true
      })

      // 构建待导入的数据源列表
      const fileList: ExternalDataSource[] = []
      for (const filePath of uniqueFiles) {
        const fileName = filePath.split(/[/\\]/).pop() || 'unknown'
        // 获取导入的根文件夹名称作为 folderPath 的前缀
        const rootFolderName = getPathBasename(folderPath)
        // 计算相对于导入文件夹根目录的路径
        let relativePath = filePath.replace(folderPath, '').replace(/^[/\\]/, '')
        // 如果 relativePath 等于文件名，说明文件在文件夹根目录，设置为根文件夹名称
        if (relativePath === fileName && rootFolderName) {
          relativePath = rootFolderName
        } else if (relativePath && rootFolderName) {
          // 文件在子文件夹中，添加根文件夹前缀，使用跨平台路径分隔符
          const sep = platformDetector.isWindows() ? '\\' : '/'
          relativePath = rootFolderName + sep + relativePath
        }

        fileList.push({
          id: `ds_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          name: fileName,
          fileId: filePath,
          type: getFileTypeFromExtension(fileName),
          status: 'ready',
          lastUsed: new Date().toISOString(),
          addedAt: new Date().toISOString(),
          alias: undefined,
          sourceMode: 'localfile',
          localPath: filePath,
          folderPath: relativePath,
          isFolder: false,
        })
      }

      // 与 workspaceStore 中已有数据源交叉去重，避免重复录入
      const newFileList = filterExistingDataSources(fileList, workspaceStore)

      for (const dataSource of newFileList) {
        try {
          await workspaceStore.addDataSource(
            dataSource.fileId,
            dataSource.name,
            dataSource.type,
            dataSource.sourceMode,
            dataSource.localPath,
            dataSource.folderPath
          )
          successCount++
          logger.debug(`数据源 ${dataSource.name} 添加成功`)
        } catch (error) {
          failCount++
          logger.error(`添加数据源 ${dataSource.name} 失败:`, error)
        }
      }

      if (failCount > 0) {
        toastInfo(`文件夹导入完成：成功 ${successCount} 个，失败 ${failCount} 个`)
      } else {
        logger.debug(`[useDataSourceImport] 文件夹导入完成：共 ${successCount} 个文件`)
      }
    } catch (error) {
      logger.error('[useDataSourceImport] 文件夹导入失败:', error)
      const errorMessage = error instanceof Error ? error.message : String(error)
      toastError(`文件夹导入失败: ${errorMessage}`)
    }
  }

  /**
   * 处理重新加载文件上传
   *
   * 监听 reload-file-uploaded 事件，更新或创建对应的数据源，
   * 并触发 data-source-refreshed 事件通知关联节点刷新。
   *
   * @param event - 重新加载文件自定义事件
   */
  const handleReloadFileUploaded = async (event: Event) => {
    const detail = (event as CustomEvent).detail
    const file = detail.file as File
    const nodeId = detail.nodeId
    const sourceName = detail.sourceName

    logger.debug('[useDataSourceImport] 处理重新加载文件:', file.name, 'nodeId:', nodeId)

    try {
      // 注：IndexedDB 已移除，使用文件名作为 fileId
      const fileId = file.name

      const dataSources = workspaceStore.getDataSources()
      const existingSource = dataSources.find((ds) => ds.name === sourceName)

      if (existingSource) {
        const updatedSource: ExternalDataSource = {
          ...existingSource,
          fileId: fileId,
          name: file.name,
        }
        workspaceStore.updateDataSource(existingSource.id, updatedSource)
        logger.debug('[useDataSourceImport] 数据源已更新')
      } else {
        const newDataSource: ExternalDataSource = {
          id: `ds_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          name: file.name,
          fileId: fileId,
          type: getFileTypeFromExtension(file.name),
          status: 'ready',
          lastUsed: new Date().toISOString(),
          addedAt: new Date().toISOString(),
        }

        await workspaceStore.addDataSource(
          newDataSource.fileId,
          newDataSource.name,
          newDataSource.type
        )
        logger.debug('[useDataSourceImport] 新数据源已添加')
      }

      // 触发数据刷新事件
      eventBus.emit('data-source-refreshed', {
        nodeId: nodeId,
        fileId: fileId,
        fileName: file.name,
      })
      logger.debug('[useDataSourceImport] 数据刷新事件已触发')

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
    handleReloadFileUploaded,
  }
}
