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
 * - 全局无状态处理器，不依赖组件 props
 * - 处理 JsonSourcePreview → JsonSchema 的全局连接事件
 * - 使用 useGlobalConfirm 进行确认对话框
 * - 使用 generateJsonColumnsFromSource 进行列生成
 * - 参考 Table Schema 的实现，简化连接处理逻辑
 */

import { logger } from '@/core/utils/logger'
import { nextTick } from 'vue'
import { useI18n } from 'vue-i18n'

import { useGraphStore } from '@/stores/graphStore'
import { useGlobalConfirm } from '@/composables/useGlobalConfirm'
import { useToast } from '@/composables/shared/useToast'
import { generateJsonColumnsFromSource } from '@/utils/nodes/json/columnGeneration'
import { compareColumns } from '@/utils/nodes/schema/columnValidation'
import type { JsonSchemaNodeData, JsonSourcePreviewNodeData } from '@/types/nodes'

/**
 * JSON Schema 节点连接处理器
 *
 * 核心职责：
 * - SourcePreview 到 Schema 的连接处理
 * - 智能填充对话框
 * - 连接状态变化监听
 *
 * 设计变更：移除 props/emit 依赖，改为全局无状态处理器
 * 所有方法从 store 动态获取节点数据，支持在 useConnections.ts 中全局调用
 */
export function useJsonSchemaConnectionHandler() {
  const { t } = useI18n()
  const { showConfirm } = useGlobalConfirm()
  const toast = useToast()
  const success = toast.success
  const showError = toast.error
  const info = toast.info

  const store = useGraphStore()

  /**
   * 显示智能填充询问对话框
   * 询问用户是否要根据 JSON 数据源自动生成列定义
   *
   * @param sourceNode - 数据源节点（包含 id 和 data）
   * @param schemaNode - Schema 节点（包含 id 和 data）
   * @returns 是否执行了列生成操作
   */
  const showSmartFillDialog = async (sourceNode: any, schemaNode: any) => {
    const sourceData = sourceNode?.data ?? sourceNode
    const schemaData = schemaNode?.data ?? schemaNode

    const sourceName = sourceData?.sourceName || sourceData?.fileName || 'Unknown'
    const schemaName = schemaData?.tableName || 'JsonSchema'

    const rawData = sourceData?.rawData
    if (!rawData || !Array.isArray(rawData) || rawData.length === 0) {
      logger.warn('🎯 [showSmartFillDialog] JSON rawData 为空，跳过智能填充')
      info(t('canvas.nodeCanvas.jsonSourceEmpty'))
      return false
    }

    const firstRecord = rawData[0]
    if (!firstRecord || typeof firstRecord !== 'object') {
      logger.warn('🎯 [showSmartFillDialog] JSON 第一条记录不是对象，跳过智能填充')
      info(t('canvas.nodeCanvas.jsonSourceInvalid'))
      return false
    }

    const sourceColumnNames = Object.keys(firstRecord)

    const schemaColumns = (schemaData?.columns || []) as {
      columnName: string
      expressionType?: string
      isBound?: boolean
      extractedConfig?: unknown
    }[]
    const comparison = compareColumns(sourceColumnNames, schemaColumns)

    logger.debug('🎯 [showSmartFillDialog] JSON 列比较结果:', comparison)

    if (comparison.schemaEmpty) {
      const userConfirmed = await showConfirm({
        title: t('canvas.nodeCanvas.smartFill.title'),
        message: t('canvas.nodeCanvas.smartFill.message', {
          sourceName,
          schemaName,
          currentColumnsCount: 0,
        }),
        confirmText: t('canvas.nodeCanvas.smartFill.confirm'),
        cancelText: t('common.cancel'),
      })

      logger.debug('🎯 [showSmartFillDialog] 用户选择:', userConfirmed ? '✅ 确认生成' : '❌ 取消')

      if (userConfirmed) {
        generateColumnsFromSource(schemaNode.id, sourceData)
        return true
      }
    } else if (comparison.needsAction) {
      const parts: string[] = []
      if (comparison.newInSource.length > 0) {
        const preview = comparison.newInSource.slice(0, 5).join(', ')
        const suffix = comparison.newInSource.length > 5 ? ` 等 ${comparison.newInSource.length} 个` : ''
        parts.push(t('canvas.nodeCanvas.smartFix.newInSource', { count: comparison.newInSource.length, columns: `${preview}${suffix}` }))
      }
      if (comparison.staleInSchema.length > 0) {
        const preview = comparison.staleInSchema.slice(0, 5).join(', ')
        const suffix = comparison.staleInSchema.length > 5 ? ` 等 ${comparison.staleInSchema.length} 个` : ''
        parts.push(t('canvas.nodeCanvas.smartFix.staleInSchema', { count: comparison.staleInSchema.length, columns: `${preview}${suffix}` }))
      }

      const result = await showConfirm({
        title: t('canvas.nodeCanvas.smartFix.title'),
        message: t('canvas.nodeCanvas.smartFix.message', {
          sourceName,
          schemaName,
          details: parts.join('\n'),
        }),
        confirmText: t('canvas.nodeCanvas.smartFix.confirm'),
        cancelText: t('common.cancel'),
        alternativeText: t('canvas.nodeCanvas.smartFix.skip'),
        type: 'warning',
      })

      logger.debug('🎯 [showSmartFillDialog] 用户选择:', result === true ? '✅ 智能修正' : '❌ 跳过/取消')

      if (result === true) {
        generateColumnsFromSource(schemaNode.id, sourceData)
        return true
      }
    } else {
      logger.debug('🎯 [showSmartFillDialog] JSON 列定义已匹配数据源，跳过智能填充')
    }

    return false
  }

  /**
   * 从数据源生成列定义
   *
   * @param schemaNodeId - Schema 节点 ID
   * @param sourceNodeData - 数据源节点数据
   */
  const generateColumnsFromSource = (schemaNodeId: string, sourceNodeData: any) => {
    logger.debug('🎯 [generateColumnsFromSource] 开始生成 JSON 列定义！')
    logger.debug('  - schemaNodeId:', schemaNodeId)

    const schemaNode = store.nodes.find((n) => n.id === schemaNodeId)
    if (!schemaNode) {
      throw new Error(`Schema 节点 ${schemaNodeId} 不存在`)
    }

    const schemaData = schemaNode.data as JsonSchemaNodeData
    const sourceData = sourceNodeData as JsonSourcePreviewNodeData
    const rawData = sourceData.rawData

    if (!rawData || !Array.isArray(rawData) || rawData.length === 0) {
      throw new Error('JSON 数据源为空，无法生成列定义')
    }

    logger.debug('📊 JSON 原始数据记录数:', rawData.length)
    logger.debug('📈 第一条记录:', rawData[0])

    const originalColumns = schemaData.columns || []

    const columns = generateJsonColumnsFromSource(rawData, originalColumns, {
      forceReinferTypes: true,
    })

    logger.debug('生成的 JSON 列定义:', columns)

    const updatedSchemaData = {
      ...schemaData,
      columns,
    }

    store.updateNodeData(schemaNodeId, updatedSchemaData)

    logger.debug('🎯 [generateColumnsFromSource] 列定义生成完成！')
    logger.debug('  - 新列定义数量:', columns.length)
    logger.debug('  - JsonSchema 节点 ID:', schemaNodeId)

    success(t('canvas.nodeCanvas.columnsGenerated'))
  }

  /**
   * 处理 JsonSourcePreview 节点到 JsonSchema 节点的连接
   *
   * @param connection - VueFlow 连接对象，包含 source 和 target 节点 ID
   */
  const handleSourceConnection = async (connection: { source: string; target: string }) => {
    const { source: sourcePreviewNodeId, target: schemaNodeId } = connection

    const sourcePreviewNode = store.nodes.find((n) => n.id === sourcePreviewNodeId)
    const schemaNode = store.nodes.find((n) => n.id === schemaNodeId)
    if (!sourcePreviewNode || !schemaNode) {
      throw new Error('源节点或目标节点不存在')
    }

    logger.debug('🔌 [handleSourceConnection] 开始处理 JSON 连接')
    logger.debug(
      '  - jsonSchemaNode 当前列定义数量:',
      (schemaNode.data as JsonSchemaNodeData).columns?.length || 0
    )

    const sourceData = sourcePreviewNode.data as JsonSourcePreviewNodeData

    const displayFileName = sourceData.sourceName || sourceData.fileName || 'Unknown'

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
        }
        store.deleteConnection(edge.id)
      }

      info(t('canvas.nodeCanvas.disconnectedOldSource', { sourceName: displayFileName }))
    }
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

    success(
      t('canvas.nodeCanvas.connectionSuccess', {
        source: displayFileName,
        target: smartTableName,
      })
    )

    store.updateNodeData(sourcePreviewNodeId, {
      ...sourceData,
      outputPortConnected: true,
    })

    logger.debug('🔌 [handleSourceConnection] 连接处理完成，准备弹出确认对话框')

    await nextTick()
    const latestSourceNode = store.nodes.find((n: any) => n.id === sourcePreviewNodeId)
    const latestSchemaNode = store.nodes.find((n: any) => n.id === schemaNodeId)

    if (latestSourceNode && latestSchemaNode) {
      try {
        const sourceDataSnapshot = JSON.parse(JSON.stringify(latestSourceNode.data))
        await showSmartFillDialog(
          { id: sourcePreviewNodeId, data: sourceDataSnapshot },
          { id: schemaNodeId, data: latestSchemaNode.data }
        )
      } catch (error: any) {
        if (error.message?.includes('JSON 数据源为空') || error.message?.includes('格式不正确')) {
          logger.warn('🎯 [handleSourceConnection] 智能填充业务跳过:', error.message)
        } else {
          throw error
        }
      }

      setTimeout(() => {
        logger.debug('🔄 [handleSourceConnection] 触发 JSON Schema 自动校验')
        const event = new CustomEvent('validate-json-schema', {
          detail: { nodeId: schemaNodeId },
        })
        document.dispatchEvent(event)
      }, 500)
    }
  }

  return {
    showSmartFillDialog,
    handleSourceConnection,
    generateColumnsFromSource,
  }
}
