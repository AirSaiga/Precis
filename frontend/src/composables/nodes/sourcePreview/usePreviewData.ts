/**
 * @file usePreviewData.ts
 * @description 数据源预览数据管理模块
 *
 * 【架构背景与设计决策】
 * 本模块是 SourcePreviewNode 组件的核心数据管理层，负责：
 * 1. 管理预览节点的本地数据副本（响应式）
 * 2. 实现双模式数据读取（IndexedDB / 本地路径）
 * 3. 处理工作表切换
 * 4. 同步数据变更到 Graph Store 和父组件
 *
 * 【数据流架构】
 * 父组件 props.data -> localData (响应式副本) -> 操作后 -> Graph Store + 父组件 emit
 *
 * 【双模式支持】
 * - indexeddb: 通过 getFile() 从 IndexedDB 读取，再 POST 到 /preview/switch-sheet/content
 * - localfile: 直接 POST 文件路径到 /preview/switch-sheet/path，后端读取本地文件
 *
 * 【事件通信】
 * - data-source-refreshed: 全局事件，由 DataLibrary 触发，通知节点刷新数据
 * - sourcePreviewDataChanged: 节点内部事件，通知下游 SchemaNode 更新
 *
 * 【重要变更历史】
 * 2026年3月：IndexedDB 模式已移除，当前仅支持 localfile 模式
 * 以下函数已废弃：selectSheetFromIndexedDB, reloadFromIndexedDB
 */

import { logger } from '@/core/utils/logger'
import apiClient from '@/core/services/httpClient'
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useGlobalConfirm } from '@/composables/useGlobalConfirm'
import { useGraphStore } from '@/stores/graphStore'
import { eventBus } from '@/core/eventBus'
import { toastError } from '@/core/toast'
import type { SourcePreviewNodeData } from '../types'
import type { SourceMode } from '@/types/datasource'
interface PreviewReloadResponse {
  success: boolean
  data?: unknown[][]
  total_rows?: number
  total_cols?: number
  sheets?: string[]
  current_sheet?: string
  file_name?: string
  error?: string
}

function isPreviewReloadResponse(data: unknown): data is PreviewReloadResponse {
  return typeof data === 'object' && data !== null && 'success' in data
}

/**
 * 数据源预览数据管理 Composable
 *
 * 【核心职责】
 * - 创建和管理本地数据副本（localData）
 * - 提供数据操作方法（selectSheet, reloadFrom*）
 * - 同步数据变更到 Graph Store 和父组件
 * - 处理全局数据刷新事件
 *
 * 【状态管理】
 * - localData: SourcePreviewNodeData 的响应式副本
 * - isReloading: 标记是否正在重载数据，用于 UI 显示加载状态
 *
 * 【Vue 响应式系统集成】
 * - watch: 监听 props.data 变化，自动同步到本地副本
 * - onMounted/onUnmounted: 生命周期事件监听器管理
 *
 * @param props - 组件属性
 * @param props.id - 节点唯一标识符
 * @param props.data - 节点的初始数据
 * @param emit - Vue emit 函数，用于通知父组件数据变更
 * @returns 包含数据状态和操作方法的对象
 */
export function usePreviewData(
  props: { id: string; data: SourcePreviewNodeData },
  emit: (event: string, ...args: unknown[]) => void
) {
  // 国际化支持，用于显示确认对话框文本
  const { t } = useI18n()
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- 当前未使用，保留以支持后续扩展或模板使用
  const { showConfirm } = useGlobalConfirm()
  // 获取全局图存储，用于访问和修改节点数据
  const store = useGraphStore()

  /**
   * 本地数据副本
   * 【设计理由】
   * - 避免直接修改 props.data，保持 Vue 单向数据流原则
   * - 使用 ref 确保响应式，UI 自动更新
   * - 所有数据操作都基于此副本进行
   */
  const localData = ref<SourcePreviewNodeData>({ ...props.data })

  /**
   * 重载状态标记
   * 【使用场景】
   * - UI 显示加载动画（如禁用按钮、显示 spinner）
   * - 防止重复触发重载操作
   */
  const isReloading = ref(false)

  /**
   * 监听 props.data 变化
   * 【触发时机】
   * - 父组件更新节点数据时
   * - 从 Graph Store 恢复数据时
   *
   * 【注意事项】
   * 使用 deep: true 监听嵌套属性，避免深层更新遗漏
   */
  watch(
    () => props.data,
    (newData) => {
      localData.value = { ...newData }
    },
    { deep: true }
  )

  /**
   * 获取当前数据来源模式
   *
   * 【默认值】
   * - 未设置 sourceMode 时默认为 'localfile'
   * - 保证向后兼容旧数据
   *
   * 【变更历史】
   * 2026年3月：IndexedDB 模式已移除，始终返回 'localfile'
   *
   * @returns 'localfile'（当前唯一支持的模式）
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- 当前未使用，保留以支持后续扩展或模板使用
  const getSourceMode = (): SourceMode => {
    // 2026年3月：始终返回 localfile，IndexedDB 模式已移除
    return 'localfile'
  }

  /**
   * 判断是否为本地路径模式
   *
   * 【使用场景】
   * - 在 selectSheet、reloadFrom* 等方法中判断调用哪个实现
   * - 简化条件判断逻辑
   *
   * 【变更历史】
   * 2026年3月：始终返回 true，因为 IndexedDB 模式已移除
   *
   * @returns true 表示本地路径模式（Electron 环境）
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- 当前未使用，保留以支持后续扩展或模板使用
  const isLocalFileMode = (): boolean => {
    return true
  }

  /**
   * 通知父组件数据变更
   *
   * 【调用时机】
   * - 数据更新后需要通知父组件同步
   * - 保持父组件状态与本地副本一致
   *
   * 【数据流】
   * localData -> emit('dataChanged') -> 父组件处理
   */
  const notifyDataChange = () => {
    emit('dataChanged', localData.value)
  }

  /**
   * 处理数据源刷新事件
   *
   * 【事件来源】
   * - DataLibrary 组件在用户重新上传文件后触发
   * - 事件名称：data-source-refreshed
   *
   * 【事件处理流程】
   * 1. 验证事件 payload 是否属于当前节点
   * 2. 更新本地数据的 fileId 和 fileName
   * 3. 调用本地路径模式的重载方法
   *
   * @param event - DOM 事件对象
   */
  const handleDataSourceRefreshed = async (detail: {
    nodeId: string
    fileId: string
    fileName: string
  }) => {
    if (!detail || detail.nodeId !== props.id) {
      return
    }

    const fileId = detail.fileId
    const fileName = detail.fileName

    if (!fileId) {
      return
    }

    const updatedData: SourcePreviewNodeData = {
      ...localData.value,
      localPath: fileId,
      fileName: fileName || localData.value.fileName,
    }

    localData.value = updatedData
    store.updateNodeData(props.id, updatedData)

    // 只使用本地路径模式（IndexedDB 模式已移除）
    await reloadFromLocalFile()
  }

  /**
   * 生命周期：挂载时注册全局事件监听器
   */
  onMounted(() => {
    eventBus.on('data-source-refreshed', handleDataSourceRefreshed)
  })

  /**
   * 生命周期：卸载时移除事件监听器
   * 【重要性】防止内存泄漏和重复调用
   */
  onUnmounted(() => {
    eventBus.off('data-source-refreshed', handleDataSourceRefreshed)
  })

  /**
   * 切换工作表（统一入口）
   *
   * 【设计模式】
   * - 策略模式：根据 sourceMode 选择具体实现
   * - 外部调用方无需关心内部实现细节
   *
   * 【调用链】
   * selectSheet -> (localfile ? selectSheetFromPath : selectSheetFromIndexedDB)
   *
   * 【变更历史】
   * 2026年3月：移除 IndexedDB 支持，现在直接调用 selectSheetFromPath
   *
   * @param sheet - 要切换到的工作表名称
   */
  const selectSheet = async (sheet: string) => {
    await selectSheetFromPath(sheet)
  }

  /**
   * 从 IndexedDB 切换工作表（浏览器环境）
   *
   * 【实现原理】
   * 1. 通过 fileId 从 IndexedDB 获取存储的文件
   * 2. 将文件内容封装为 FormData
   * 3. POST 到 /preview/switch-sheet/content 接口
   * 4. 后端解析文件并返回指定工作表数据
   *
   * 【错误处理】
   * - 文件不存在：记录错误日志，不更新数据
   * - HTTP 错误：记录错误日志
   * - API 返回失败：记录错误信息
   *
   * 【废弃说明】
   * 2026年3月：此函数已废弃，IndexedDB 模式不再支持
   * 保留注释用于历史参考
   *
   * @deprecated 2026年3月 - IndexedDB 模式已移除
   * @param sheet - 要切换到的工作表名称
   */
  // const selectSheetFromIndexedDB = async (sheet: string) => {
  //   // ...（已废弃的实现）
  // };

  /**
   * 从本地路径切换工作表（Electron 环境）
   *
   * 【实现原理】
   * 1. 提取当前文件的本地路径
   * 2. POST 到 /preview/switch-sheet/path 接口
   * 3. 后端读取文件并返回指定工作表数据
   * 4. 更新本地副本和 Graph Store
   *
   * 【数据流】
   * localData.localPath -> /preview/switch-sheet/path -> 后端 pandas -> response -> update
   *
   * @param sheet - 要切换到的工作表名称
   */
  const selectSheetFromPath = async (sheet: string) => {
    const filePath = localData.value.localPath

    if (!filePath) {
      logger.error('路径方式切换工作表失败: 文件路径为空')
      return
    }

    logger.debug('🔄 从本地路径切换工作表:', { filePath, sheet })

    try {
      const response = await apiClient.post('/preview/switch-sheet/path', {
        file_path: filePath,
        sheet_name: sheet,
        max_rows: 65535,
        max_cols: 65535,
      })
      const data = response.data

      if (data.success) {
        const updatedData: SourcePreviewNodeData = {
          ...localData.value,
          currentSheet: data.current_sheet || sheet,
          data: data.data || [],
          totalRows: data.total_rows || 0,
          totalCols: data.total_cols || 0,
          sheets: data.sheets || localData.value.sheets,
          rowCount: data.total_rows || 0,
          colCount: data.total_cols || 0,
          previewRowCount: data.total_rows || 0,
          previewColCount: data.total_cols || 0,
        }

        localData.value = updatedData
        store.updateNodeData(props.id, updatedData)
        notifyDataChange()

        eventBus.emit('sourcePreviewDataChanged', {
          nodeId: props.id,
          data: updatedData as unknown as Record<string, unknown>,
        })

        logger.debug('✅ 本地路径方式工作表切换完成:', { sheet: updatedData.currentSheet })
      } else {
        logger.error('本地路径方式切换工作表失败:', data.error || '未知错误')
      }
    } catch (error) {
      logger.error('本地路径方式切换工作表错误:', error)
    }
  }

  /**
   * 从 IndexedDB 重新加载数据（浏览器环境）
   *
   * 【使用场景】
   * - 用户点击重载按钮
   * - 数据源刷新事件触发
   * - 节点初始化时加载数据
   *
   * 【实现逻辑】
   * 1. 标记 isReloading = true
   * 2. 从 IndexedDB 获取文件
   * 3. POST 到后端接口
   * 4. 更新本地副本和 Graph Store
   * 5. 派发数据变更事件
   * 6. 标记 isReloading = false
   *
   * 【废弃说明】
   * 2026年3月：此函数已废弃，IndexedDB 模式不再支持
   * 保留注释用于历史参考
   *
   * @deprecated 2026年3月 - IndexedDB 模式已移除
   */
  // const reloadFromIndexedDB = async () => {
  //   // ...（已废弃的实现）
  // };

  /**
   * 从本地路径重新加载数据（Electron 环境）
   *
   * 【实现原理】
   * 直接将文件路径 POST 到 /preview/file/path 接口，后端直接读取文件系统
   *
   * 【与 IndexedDB 模式的差异】
   * - 无需从 IndexedDB 读取文件内容
   * - 无需上传文件数据到后端
   * - 直接读取本地文件的最新版本
   *
   * 【适用场景】
   * - 用户在外部修改了源文件
   * - 需要获取文件最新内容
   */
  const reloadFromLocalFile = async () => {
    const filePath = localData.value.localPath

    if (!filePath) {
      logger.error('本地路径方式重载失败: 文件路径为空')
      toastError(t('messages.previewData.reloadEmptyPath'))
      return
    }

    isReloading.value = true
    logger.debug('🔄 使用本地路径方式重载数据:', { filePath, sheet: localData.value.currentSheet })

    try {
      const requestBody = {
        file_path: filePath,
        max_rows: 65535,
        max_cols: 65535,
        sheet_name: localData.value.currentSheet || null,
      }

      let data: unknown
      try {
        const response = await apiClient.post('/preview/file/path', requestBody)
        data = response.data
      } catch (error: unknown) {
        const err = error as Record<string, unknown>
        const response = (err.response ?? {}) as Record<string, unknown>
        const status = response.status as number | undefined
        const respData = response.data
        const errorText =
          typeof respData === 'string'
            ? respData
            : ((respData as Record<string, unknown>)?.error as string | undefined) ||
              ((respData as Record<string, unknown>)?.message as string | undefined) ||
              (err.message as string | undefined) ||
              '未知错误'
        logger.error('本地路径方式重载HTTP错误:', status, errorText)
        toastError(t('messages.previewData.reloadInvalidPath'))
        return
      }

      const responseData = isPreviewReloadResponse(data) ? data : null
      if (!responseData) {
        logger.error('本地路径方式重载返回数据格式异常')
        toastError(t('messages.previewData.reloadErrorWithPath'))
        return
      }

      if (responseData.success) {
        const updatedData: SourcePreviewNodeData = {
          ...localData.value,
          data: (responseData.data as string[][]) || [],
          totalRows: responseData.total_rows || 0,
          totalCols: responseData.total_cols || 0,
          actualRowCount: responseData.total_rows || 0,
          actualColCount: responseData.total_cols || 0,
          rowCount: responseData.total_rows || 0,
          colCount: responseData.total_cols || 0,
          previewRowCount: responseData.total_rows || 0,
          previewColCount: responseData.total_cols || 0,
          sheets: (responseData.sheets as string[]) || localData.value.sheets,
          currentSheet: responseData.current_sheet || localData.value.currentSheet,
          fileName: responseData.file_name || localData.value.fileName,
        }

        localData.value = updatedData
        store.updateNodeData(props.id, updatedData)
        notifyDataChange()

        eventBus.emit('sourcePreviewDataChanged', {
          nodeId: props.id,
          data: updatedData as unknown as Record<string, unknown>,
        })

        logger.debug('✅ 本地路径方式重载成功:', {
          rows: updatedData.totalRows,
          cols: updatedData.totalCols,
          sheets: updatedData.sheets,
        })
      } else {
        logger.error('本地路径方式重载失败:', responseData.error)
        toastError(`重载数据失败: ${responseData.error || '未知错误'}`)
      }
    } catch (error) {
      logger.error('本地路径方式重载错误:', error)
      toastError(t('messages.previewData.reloadErrorWithPath'))
    } finally {
      isReloading.value = false
    }
  }

  /**
   * 触发文件选择器
   *
   * 【使用场景】
   * - 用户需要替换当前数据源
   * - 浏览器环境下的手动重载方式
   *
   * 【事件流】
   * input.onchange -> CustomEvent('reload-file-uploaded') -> DataLibrary 处理
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- 当前未使用，保留以支持后续扩展或模板使用
  const triggerFileSelection = () => {
    const input = document.createElement('input')
    input.type = 'file'
    const getAcceptExtensions = () => {
      switch (localData.value.sourceType) {
        case 'excel':
          return '.xlsx,.xls'
        case 'csv':
          return '.csv'
        case 'json':
          return '.json'
        default:
          return '.xlsx,.xls,.csv,.json'
      }
    }
    input.accept = getAcceptExtensions()
    input.multiple = false

    input.onchange = async (e: Event) => {
      const target = e.target as HTMLInputElement
      const files = target.files

      if (files && files.length > 0) {
        const file = files[0]
        if (!file) return
        logger.debug('User selected file:', file.name)

        try {
          eventBus.emit('reload-file-uploaded', {
            file: file,
            nodeId: props.id,
            sourceName: localData.value.sourceName || '',
          })
          logger.debug('File upload event dispatched')
        } catch (error) {
          logger.error('Failed to process file:', error)
          toastError('Failed to process file')
        }
      }
    }

    input.click()
  }

  /**
   * 重新加载文件预览数据（统一入口）
   *
   * 【设计模式】
   * - 策略模式：根据 sourceMode 选择重载方式（现为单一模式）
   * - 外部调用方只需调用此方法，无需关心内部实现
   *
   * 【调用链】
   * handleReloadData -> reloadFromLocalFile（唯一支持的模式）
   *
   * 【变更历史】
   * 2026年3月：移除 IndexedDB 支持，仅保留本地路径模式
   */
  const handleReloadData = async () => {
    await reloadFromLocalFile()
  }

  return {
    localData,
    isReloading,
    notifyDataChange,
    selectSheet,
    selectSheetFromPath,
    reloadFromLocalFile,
    handleReloadData,
  }
}
