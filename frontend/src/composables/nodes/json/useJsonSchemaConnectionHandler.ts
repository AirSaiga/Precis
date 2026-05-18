/**
 * @file useJsonSchemaConnectionHandler.ts
 * @description JSON Schema 节点连接处理器
 *
 * 功能概述:
 * - SourcePreview 到 Schema 的连接处理
 * - 智能填充对话框
 * - 连接状态变化监听
 *
 * 架构设计:
 * - 处理 JsonSourcePreview → JsonSchema 的全局连接事件
 * - 使用 useGlobalConfirm 进行确认对话框
 * - 使用 generateJsonColumnsFromSource 进行列生成
 * - 参考 Table Schema 的实现，简化连接处理逻辑
 */

import { logger } from '@/core/utils/logger'
import { nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useVueFlow } from '@vue-flow/core'
import { useGraphStore } from '@/stores/graphStore'
import { useGlobalConfirm } from '@/composables/useGlobalConfirm'
import { useToast } from '@/composables/shared/useToast'
import { generateJsonColumnsFromSource } from '@/utils/nodes/json/columnGeneration'
import type { JsonSchemaNodeData, JsonSourcePreviewNodeData } from '@/types/nodes'

/**
 * JSON Schema 节点连接处理器
 *
 * 核心职责：
 * - SourcePreview 到 Schema 的连接处理
 * - 智能填充对话框
 * - 连接状态变化监听
 *
 * @param props - 组件属性
 * @param emit - Vue emit 函数
 * @returns 连接处理相关的方法
 */
export function useJsonSchemaConnectionHandler(
  props?: { id: string; data: JsonSchemaNodeData },
  emit?: any
) {
  // 国际化支持
  const { t } = useI18n()
  const { showConfirm } = useGlobalConfirm()
  const toast = useToast()
  const success = toast.success
  const showError = toast.error
  const info = toast.info

  // 从 VueFlow 获取边的操作方法
  const { removeEdges } = useVueFlow()
  // 获取全局图存储
  const store = useGraphStore()

  /**
   * 显示智能填充询问对话框
   * 询问用户是否要根据 JSON 数据源自动生成列定义
   *
   * @param sourceNode - 数据源节点
   */
  const showSmartFillDialog = async (sourceNode: any) => {
    const sourceData = sourceNode?.data ?? sourceNode
    const schemaData = props?.data

    const sourceName = sourceData?.sourceName || sourceData?.fileName || 'Unknown'
    const schemaName = schemaData?.tableName || 'JsonSchema'
    const currentColumnsCount = schemaData?.columns?.length || 0

    logger.debug('🎯 [showSmartFillDialog] 弹出 JSON 智能填充确认对话框')
    logger.debug('  - JSON 数据源:', sourceName)
    logger.debug('  - 目标 JsonSchema:', schemaName)
    logger.debug('  - 当前已有列数量:', currentColumnsCount)

    const userConfirmed = await showConfirm({
      title: t('canvas.nodeCanvas.smartFill.title'),
      message: t('canvas.nodeCanvas.smartFill.message', {
        sourceName,
        schemaName,
        currentColumnsCount,
      }),
      confirmText: t('canvas.nodeCanvas.smartFill.confirm'),
      cancelText: t('common.cancel'),
    })

    logger.debug('🎯 [showSmartFillDialog] 用户选择:', userConfirmed ? '✅ 确认生成' : '❌ 取消')

    if (userConfirmed) {
      logger.debug('🎯 [showSmartFillDialog] 开始生成 JSON 列定义...')
      generateColumnsFromSource(sourceNode)
    } else {
      logger.debug('🎯 [showSmartFillDialog] 用户取消，保持现有列定义')
      checkColumnMismatch(sourceNode)
    }
  }

  /**
   * 处理智能填充
   *
   * @param sourceNode - 数据源节点
   * @param strategy - 填充策略: merge（合并）或 replace（替换）
   */
  const handleSmartFill = async (sourceNode: any, strategy: 'merge' | 'replace' = 'merge') => {
    if (strategy === 'replace') {
      generateColumnsFromSource(sourceNode)
    } else {
      // merge 策略：智能合并
      await showSmartFillDialog(sourceNode)
    }
  }

  /**
   * 从数据源生成列定义
   *
   * @param sourceNode - 数据源节点
   */
  const generateColumnsFromSource = (sourceNode: any) => {
    if (!props) {
      logger.error('generateColumnsFromSource 需要 props 参数')
      return
    }

    try {
      logger.debug('🎯 [generateColumnsFromSource] 开始生成 JSON 列定义！')
      logger.debug('  - sourceNodeId:', sourceNode.id)
      logger.debug('  - schemaNodeId:', props.id)
      logger.debug('  - 生成前列定义数量:', props.data.columns?.length || 0)

      const sourceData = sourceNode.data as JsonSourcePreviewNodeData
      const rawData = sourceData.rawData

      if (!rawData || !Array.isArray(rawData) || rawData.length === 0) {
        showError(t('canvas.nodeCanvas.jsonSourceEmpty'))
        return
      }

      logger.debug('📊 JSON 原始数据记录数:', rawData.length)
      logger.debug('📈 第一条记录:', rawData[0])

      // 保存原有列数据
      const originalColumns = props.data.columns || []

      // 生成新列
      const columns = generateJsonColumnsFromSource(rawData, originalColumns, {
        forceReinferTypes: true,
      })

      logger.debug('生成的 JSON 列定义:', columns)

      // 更新节点数据
      const updatedSchemaData = {
        ...props.data,
        columns,
      }

      store.updateNodeData(props.id, updatedSchemaData)

      logger.debug('🎯 [generateColumnsFromSource] 列定义生成完成！')
      logger.debug('  - 新列定义数量:', columns.length)
      logger.debug('  - JsonSchema 节点 ID:', props.id)

      success(t('canvas.nodeCanvas.columnsGenerated'))
    } catch (error) {
      logger.error('生成 JSON 列定义失败:', error)
      showError(t('canvas.nodeCanvas.columnGenerationFailed'))
    }
  }

  /**
   * 检查数据源列名与 Schema 定义是否匹配
   *
   * @param sourcePreviewNode - 数据源节点
   */
  const checkColumnMismatch = async (sourcePreviewNode: any) => {
    const sourceData = sourcePreviewNode?.data ?? sourcePreviewNode
    const rawData = sourceData?.rawData

    if (!rawData || !Array.isArray(rawData) || rawData.length === 0) return

    const schemaColumns = props?.data?.columns || []
    if (schemaColumns.length === 0) return

    // 从第一条记录获取所有 key
    const firstRecord = rawData[0]
    if (!firstRecord || typeof firstRecord !== 'object') return

    const sourceKeys = new Set(Object.keys(firstRecord))

    // 找出 Schema 中定义的列在数据源中不存在的
    const missingKeys = schemaColumns
      .map((c) => c.columnName)
      .filter((name) => !sourceKeys.has(name))

    if (missingKeys.length > 0) {
      const missingCount = missingKeys.length
      const previewMissing = missingKeys.slice(0, 5).join(', ')
      const suffix = missingKeys.length > 5 ? '...' : ''

      logger.warn(`⚠️ JSON 列不匹配警告: 缺少 ${missingCount} 个字段`, missingKeys)

      await showConfirm({
        title: t('canvas.nodeCanvas.columnMismatch.title'),
        message: t('canvas.nodeCanvas.columnMismatch.message', {
          schemaCount: schemaColumns.length,
          missingCount: missingCount,
          missingColumns: `${previewMissing}${suffix}`,
        }),
        confirmText: t('canvas.nodeCanvas.columnMismatch.confirm'),
        cancelText: t('common.cancel'),
      })
    }
  }

  /**
   * 处理 JsonSourcePreview 节点到 JsonSchema 节点的连接
   * 参考 Table Schema 的实现，简化逻辑
   *
   * @param connection - VueFlow 连接对象
   */
  const handleSourceConnection = async (connection: { source: string; target: string }) => {
    const { source: sourcePreviewNodeId, target: schemaNodeId } = connection

    const sourcePreviewNode = store.nodes.find((n) => n.id === sourcePreviewNodeId)
    const schemaNode = store.nodes.find((n) => n.id === schemaNodeId)
    if (!sourcePreviewNode || !schemaNode) return

    try {
      logger.debug('🔌 [handleSourceConnection] 开始处理 JSON 连接')
      logger.debug(
        '  - jsonSchemaNode 当前列定义数量:',
        (schemaNode.data as JsonSchemaNodeData).columns?.length || 0
      )

      const sourceData = sourcePreviewNode.data as JsonSourcePreviewNodeData

      // 断开旧连接
      const existingEdges = store.edges.filter(
        (edge: any) =>
          edge.target === schemaNodeId &&
          edge.source !== sourcePreviewNodeId &&
          store.nodes.find((n: any) => n.id === edge.source)?.type === 'jsonSourcePreview'
      )

      if (existingEdges.length > 0) {
        logger.debug(`🔄 断开目标 JsonSchemaNode 的旧数据源连接，数量: ${existingEdges.length}`)

        for (const edge of existingEdges) {
          const oldSourceNode = store.nodes.find((n: any) => n.id === edge.source)
          if (oldSourceNode) {
            logger.debug(
              `  - 断开与 "${(oldSourceNode.data as unknown as Record<string, unknown>)?.sourceName || (oldSourceNode.data as unknown as Record<string, unknown>)?.fileName || oldSourceNode.id}" 的连接`
            )
            store.updateNodeData(oldSourceNode.id, {
              ...oldSourceNode.data,
              outputPortConnected: false,
            })
          }
          removeEdges(edge.id)
          store.deleteConnection(edge.id)
        }

        const displayFileName = sourceData.sourceName || sourceData.fileName || 'Unknown'
        info(t('canvas.nodeCanvas.disconnectedOldSource', { sourceName: displayFileName }))
      }

      // 更新元数据
      const displayFileName = sourceData.sourceName || sourceData.fileName || 'Unknown'
      const smartTableName = (sourceData.sourceName || sourceData.fileName || 'Table').replace(
        /\.[^/.]+$/,
        ''
      )

      const updatedSchemaData = {
        ...schemaNode.data,
        tableName: smartTableName,
        sourceFile: displayFileName,
        sourceFilePath: sourceData.localPath || sourceData.fileName,
        sourceType: 'json' as const,
        headerRow: sourceData.headerRow || 0,
        sourceNodeId: sourcePreviewNodeId,
        sourceMode: sourceData.sourceMode,
        localPath: sourceData.localPath,
        jsonPath: sourceData.jsonPath || '',
        recordPath: sourceData.recordPath || '',
        format: sourceData.format || 'json',
      }

      store.updateNodeData(schemaNodeId, updatedSchemaData)

      logger.debug('🔌 [handleSourceConnection] 已更新 JsonSchemaNode 元数据')

      // 显示成功提示
      success(
        t('canvas.nodeCanvas.connectionSuccess', {
          source: displayFileName,
          target: smartTableName,
        })
      )

      // 标记源节点输出端口已连接
      store.updateNodeData(sourcePreviewNodeId, {
        ...sourceData,
        outputPortConnected: true,
      })

      logger.debug('🔌 [handleSourceConnection] 连接处理完成，准备弹出确认对话框')

      // 触发智能填充
      await nextTick()
      const latestSourceNode = store.nodes.find((n: any) => n.id === sourcePreviewNodeId)

      if (latestSourceNode) {
        const sourceDataSnapshot = JSON.parse(JSON.stringify(latestSourceNode.data))
        await showSmartFillDialog({ id: sourcePreviewNodeId, data: sourceDataSnapshot })

        // 延迟触发校验
        setTimeout(() => {
          logger.debug('🔄 [handleSourceConnection] 触发 JSON Schema 自动校验')
          const event = new CustomEvent('validate-json-schema', {
            detail: { nodeId: schemaNodeId },
          })
          document.dispatchEvent(event)
        }, 500)
      }
    } catch (error) {
      logger.error('处理 JsonSourcePreview 到 JsonSchema 连线失败:', error)
      showError(t('canvas.nodeCanvas.connectionFailed'))
    }
  }

  /**
   * 处理断开连接
   *
   * @param connection - VueFlow 连接对象
   */
  const handleSourceDisconnection = (connection: { source: string; target: string }) => {
    const { source: sourcePreviewNodeId, target: schemaNodeId } = connection

    const schemaNode = store.nodes.find((n) => n.id === schemaNodeId)
    if (!schemaNode) return

    // 清除数据源信息
    const updatedSchemaData = {
      ...schemaNode.data,
      sourceNodeId: undefined,
      sourceFile: undefined,
      sourceFilePath: undefined,
      sourceType: undefined,
      sourceMode: undefined,
      localPath: undefined,
      jsonPath: undefined,
      recordPath: undefined,
    }

    store.updateNodeData(schemaNodeId, updatedSchemaData)

    // 标记源节点输出端口为未连接
    const sourceNode = store.nodes.find((n: any) => n.id === sourcePreviewNodeId)
    if (sourceNode) {
      store.updateNodeData(sourcePreviewNodeId, {
        ...sourceNode.data,
        outputPortConnected: false,
      })
    }

    logger.debug(
      `🔌 [handleSourceDisconnection] 已断开 ${sourcePreviewNodeId} -> ${schemaNodeId} 的连接`
    )
  }

  return {
    // 核心方法
    showSmartFillDialog,
    handleSmartFill,
    handleSourceConnection,
    handleSourceDisconnection,
    generateColumnsFromSource,
    checkColumnMismatch,
  }
}
