/**
 * @file useJsonSchemaSourceManager.ts
 * @description JSON Schema 数据源管理
 *
 * 功能概述:
 * - 数据源连接管理
 * - 数据源切换逻辑
 * - 连接状态检测
 *
 * 架构设计:
 * - 使用 useGlobalConfirm 进行确认对话框
 * - 通过 useGraphStore 持久化节点数据
 * - 使用事件机制进行数据同步
 * - 底层调用 useNodeSourceManager 通用逻辑
 */

import { logger } from '@/core/utils/logger'
import { eventBus } from '@/core/eventBus'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useVueFlow } from '@vue-flow/core'
import { useGraphStore } from '@/stores/graphStore'
import { useToast } from '@/composables/shared/useToast'
import { generateJsonColumnsFromSource } from '@/utils/nodes/json/columnGeneration'
import { syncJsonSchemaResources } from '@/services/jsonSchemaResourceSync'
import { useNodeSourceManager } from '../shared/useNodeSourceManager'
import type {
  CustomNode,
  JsonSchemaColumn,
  JsonSchemaNodeData,
  JsonSourcePreviewNodeData,
} from '@/types/nodes'

export function useJsonSchemaSourceManager(
  props: { id: string; data: JsonSchemaNodeData },
  emit: unknown
) {
  const { t } = useI18n()
  const { findNode: _findNode } = useVueFlow()
  const store = useGraphStore()
  const toast = useToast()
  const success = toast.success
  const error = toast.error

  // ============================================================================
  // JSON 特有计算属性
  // ============================================================================

  const hasSourceConnection = computed(() => {
    return !!props.data.sourceNodeId
  })

  const connectedSourceNodeId = computed(() => {
    return props.data.sourceNodeId || null
  })

  const connectedSourceNode = computed(() => {
    if (!props.data.sourceNodeId) return null
    return store.nodes.find((n) => n.id === props.data.sourceNodeId)
  })

  const sourceNodeData = computed(() => {
    if (!connectedSourceNode.value) return null
    return connectedSourceNode.value.data as JsonSourcePreviewNodeData
  })

  const getSourceStats = computed(() => {
    const data = sourceNodeData.value
    if (!data) {
      return {
        totalRecords: 0,
        totalFields: 0,
        fileSize: 0,
        lastModified: null,
      }
    }

    const rawData = data.rawData
    let totalRecords = 0
    let totalFields = 0

    if (Array.isArray(rawData) && rawData.length > 0) {
      totalRecords = rawData.length
      totalFields = Object.keys(rawData[0] || {}).length
    }

    return {
      totalRecords,
      totalFields,
      fileSize: data.fileSize || 0,
      lastModified: data.lastModified ? new Date(data.lastModified) : null,
    }
  })

  // ============================================================================
  // JSON 特有方法
  // ============================================================================

  const getConnectedSourceNode = () => {
    if (!props.data.sourceNodeId) return null
    return store.nodes.find((n) => n.id === props.data.sourceNodeId)
  }

  const disconnectFromSource = () => {
    if (!props.data.sourceNodeId) return

    const edgesToRemove = store.edges.filter(
      (edge) => edge.target === props.id && edge.source === props.data.sourceNodeId
    )

    for (const edge of edgesToRemove) {
      store.deleteConnection(edge.id)
    }

    const updatedSchemaData = {
      ...props.data,
      sourceNodeId: undefined,
      sourceFile: undefined,
      sourceFilePath: undefined,
      sourceType: undefined,
      sourceMode: undefined,
      localPath: undefined,
    }

    store.updateNodeData(props.id, updatedSchemaData)

    if (props.data.sourceNodeId) {
      const sourceNode = store.nodes.find((n) => n.id === props.data.sourceNodeId)
      if (sourceNode) {
        store.updateNodeData(props.data.sourceNodeId, {
          ...sourceNode.data,
          outputPortConnected: false,
        })
      }
    }

    logger.debug('🔌 已断开数据源连接')
  }

  const switchSource = (newSourceNodeId: string) => {
    disconnectFromSource()
    generic.handleSourceConnection(newSourceNodeId)
  }

  const refreshSourceData = async () => {
    if (!props.data.sourceNodeId) return

    try {
      const sourceNode = store.nodes.find((n) => n.id === props.data.sourceNodeId)
      if (!sourceNode) return

      logger.debug('🔄 刷新数据源数据:', props.data.sourceNodeId)

      eventBus.emit('json-source-preview-refresh', { nodeId: props.data.sourceNodeId })

      success(t('canvas.nodeCanvas.sourceRefreshSuccess'))
    } catch (err) {
      logger.error('刷新数据源失败:', err)
      error(t('canvas.nodeCanvas.sourceRefreshFailed'))
    }
  }

  const updateFromSourceChange = (sourceData: Record<string, unknown>) => {
    if (!sourceData) return

    const previewData = sourceData as unknown as JsonSourcePreviewNodeData
    if (!previewData.rawData) return

    const displayFileName = previewData.sourceName || previewData.fileName || 'Unknown'
    const smartTableName = (previewData.sourceName || previewData.fileName || 'JsonTable').replace(
      /\.[^/.]+$/,
      ''
    )
    const displaySourcePath = previewData.fileName || displayFileName

    const updatedSchemaData = {
      ...props.data,
      tableName: smartTableName,
      sourceFile: displayFileName,
      sourceFilePath: displaySourcePath,
      sourceType: 'json',
      headerRow: previewData.headerRow || 0,
      // 仅使用实际的工作表名称；若缺失则保持 undefined，绝不回退到文件名
      sheetName: previewData.currentSheet,
      jsonPath: previewData.jsonPath || '',
      recordPath: previewData.recordPath || '',
      format: previewData.format || 'auto',
    }

    store.updateNodeData(props.id, updatedSchemaData)
    logger.debug(`✅ JsonSchema "${smartTableName}" 已更新`)

    const currentSheetName = props.data.sheetName
    const newSheetName = previewData.currentSheet

    if (currentSheetName && newSheetName && currentSheetName !== newSheetName) {
      logger.debug('🔄 Sheet 变更，自动重新生成列定义...')
      if (props.data.sourceNodeId) {
        generic.autoGenerateColumns({
          id: props.data.sourceNodeId,
          data: sourceData,
        } as unknown as CustomNode)
      }
    }
  }

  // ============================================================================
  // 调用通用数据源管理
  // ============================================================================

  const generic = useNodeSourceManager<JsonSchemaNodeData>(props, emit, {
    sourceNodeType: 'jsonSourcePreview',
    schemaNodePrefix: 'json-schema-',
    extractMetadata: (sourceNodeId, sourceData) => {
      const previewData = sourceData as unknown as JsonSourcePreviewNodeData
      const displayFileName = previewData.sourceName || previewData.fileName || 'Unknown'
      const smartTableName = (
        previewData.sourceName ||
        previewData.fileName ||
        'JsonTable'
      ).replace(/\.[^/.]+$/, '')
      const displaySourcePath = previewData.localPath || previewData.fileName || displayFileName
      return {
        tableName: smartTableName,
        sourceFile: displayFileName,
        sourceFilePath: displaySourcePath,
        sourceType: 'json',
        headerRow: previewData.headerRow || 0,
        // 仅使用实际的工作表名称；若缺失则保持 undefined，绝不回退到文件名
        sheetName: previewData.currentSheet,
        sourceNodeId: sourceNodeId,
        sourceMode: previewData.sourceMode,
        localPath: previewData.localPath,
        jsonPath: previewData.jsonPath || '',
        recordPath: previewData.recordPath || '',
        format: previewData.format || 'auto',
      }
    },
    generateColumns: (sourceNode, existingColumns) => {
      const sourceData = sourceNode.data as JsonSourcePreviewNodeData
      const rawData = sourceData.rawData
      if (!rawData || !Array.isArray(rawData) || rawData.length === 0) {
        return existingColumns
      }
      return generateJsonColumnsFromSource(
        rawData,
        existingColumns as unknown as JsonSchemaColumn[],
        { forceReinferTypes: true }
      ) as unknown as JsonSchemaColumn[]
    },
    getSourceFields: (sourceNode) => {
      const sourceData = sourceNode.data as JsonSourcePreviewNodeData
      const rawData = sourceData.rawData
      if (!rawData || !Array.isArray(rawData) || rawData.length === 0) return undefined
      const firstRecord = rawData[0]
      if (!firstRecord || typeof firstRecord !== 'object' || Array.isArray(firstRecord))
        return undefined
      return Object.keys(firstRecord as Record<string, unknown>)
    },
    disconnectFields: [
      'sourceNodeId',
      'sourceFile',
      'sourceFilePath',
      'sourceType',
      'sourceMode',
      'localPath',
    ],
    eventName: 'jsonSourcePreviewDataChanged',
    onSourceDataChanged: (data) => updateFromSourceChange(data),
    onSourceConnected: () => {
      // 数据源连接成功后,从 V2 配置同步关联的内嵌约束节点到画布
      // 注:回调参数是 sourceNodeId,但同步需要的是 schema 节点 id(props.id)
      syncJsonSchemaResources(props.id).catch((err) => {
        logger.warn('🔄 [useJsonSchemaSourceManager] 资源同步失败:', err)
      })
    },
    resetOldSourcePort: true,
    nodeLabel: 'JsonSchema',
    onColumnsGenerated: (columns) => {
      success(t('canvas.nodeCanvas.jsonColumnsGeneratedSuccess', { count: columns.length }))
    },
    onColumnsGenerationFailed: () => {
      error(t('canvas.nodeCanvas.jsonColumnsGenerationFailed'))
    },
  })

  return {
    // 状态
    hasSourceConnection,
    connectedSourceNodeId,
    connectedSourceNode,
    sourceNodeData,
    getSourceStats,

    // 连接方法
    getConnectedSourceNode,
    connectToSource: generic.handleSourceConnection,
    disconnectFromSource,
    switchSource,
    refreshSourceData,

    // 智能填充
    showSmartFillDialog: generic.showSmartFillDialog,
    autoGenerateColumns: generic.autoGenerateColumns,

    // 约束处理
    handleConstraintConnection: generic.handleConstraintConnection,
    disconnectConstraint: generic.disconnectConstraint,

    // 辅助方法
    findConnectedSchemaNodes: generic.findConnectedSchemaNodes,
    updateFromSourceChange,
  }
}
