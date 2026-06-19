/**
 * @file generateSchema.ts
 * @description 从数据源生成 Schema 处理器（策略模式重构版）
 *
 * 功能概述：
 * - 根据选中数据源节点类型自动创建对应 Schema 节点
 * - 建立数据源到 Schema 的连接边
 * - 同步数据源元数据并自动触发智能列填充
 *
 * 重构要点：
 * - 使用 ColumnGenerationStrategy 替代直接的列生成函数
 * - 使用 PreviewDataFetcher 统一获取预览数据
 * - 保留节点/边创建逻辑（属于 UI 编排，非策略核心）
 */

import { nextTick } from 'vue'
import { logger } from '@/core/utils/logger'
import { useGraphStore } from '@/stores/graphStore'
import { tabularColumnGenerator } from '@/utils/nodes/columnGeneration/TabularColumnGenerator'
import { jsonColumnGenerator } from '@/utils/nodes/columnGeneration/JsonColumnGenerator'
import { previewDataFetcher } from '@/utils/nodes/preview/PreviewDataFetcher'
import {
  findV2SchemaIdByTableName,
  syncSchemaResources,
} from '@/services/schemaResourceSync'
import type { CustomNodeData } from '@/types/graph'

/**
 * 判断数据源节点类型对应的 Schema 节点类型
 * - sourcePreview (Excel/CSV) → schema
 * - jsonSourcePreview (JSON)   → jsonSchema
 */
type SourceNodeType = 'sourcePreview' | 'jsonSourcePreview'
type SchemaNodeType = 'schema' | 'jsonSchema'

function getSchemaTypeForSource(sourceType: SourceNodeType): SchemaNodeType {
  return sourceType === 'jsonSourcePreview' ? 'jsonSchema' : 'schema'
}

let isGenerating = false

export async function generateSchemaFromSource(): Promise<{ success: boolean; message?: string }> {
  if (isGenerating) {
    return { success: false, message: 'shortcuts.feedback.alreadyInProgress' }
  }

  isGenerating = true
  try {
    return await generateSchemaFromSourceInternal()
  } finally {
    isGenerating = false
  }
}

async function generateSchemaFromSourceInternal(): Promise<{ success: boolean; message?: string }> {
  const graphStore = useGraphStore()

  // ========== 前置检查 ==========

  if (!graphStore.selectedNodeId) {
    return { success: false, message: 'shortcuts.feedback.notSelected' }
  }

  const sourceNode = graphStore.nodes.find((n) => n.id === graphStore.selectedNodeId)
  if (!sourceNode) {
    return { success: false, message: 'shortcuts.feedback.notFound' }
  }

  // 仅支持 sourcePreview 和 jsonSourcePreview 类型节点
  const supportedTypes: SourceNodeType[] = ['sourcePreview', 'jsonSourcePreview']
  if (!supportedTypes.includes(sourceNode.type as SourceNodeType)) {
    return { success: false, message: 'shortcuts.feedback.sourceOnly' }
  }

  const sourceNodeType = sourceNode.type as SourceNodeType
  const schemaNodeType = getSchemaTypeForSource(sourceNodeType)

  // 检查该数据源是否已经连接了对应类型的 Schema 节点
  const existingSchemaEdge = graphStore.edges.find(
    (edge) =>
      edge.source === sourceNode.id &&
      graphStore.nodes.find((n) => n.id === edge.target)?.type === schemaNodeType
  )

  if (existingSchemaEdge) {
    return { success: false, message: 'shortcuts.feedback.alreadyConnected' }
  }

  // ========== 预计算表名并尝试复用 V2 Schema ID ==========
  // 语义化 ID 方案下，schema 节点 ID 即 schema ID。若 V2 配置中已存在同名 schema，
  // 复用其 ID 可避免后续 syncSchemaResources 加载 regex/约束时再次创建重复 schema。
  const sourceData = sourceNode.data as unknown as Record<string, unknown>
  const smartTableName =
    (sourceData.currentSheet as string) ||
    ((sourceData.sourceName as string) || (sourceData.fileName as string) || 'Table').replace(
      /\.[^/.]+$/,
      ''
    )

  const existingV2SchemaId = await findV2SchemaIdByTableName(smartTableName)
  if (
    existingV2SchemaId &&
    graphStore.nodes.some(
      (n) => n.id === existingV2SchemaId && (n.type === 'schema' || n.type === 'jsonSchema')
    )
  ) {
    return { success: false, message: 'shortcuts.feedback.alreadyConnected' }
  }

  // ========== 创建 Schema 节点 ==========

  const schemaPosition = {
    x: sourceNode.position.x + 450,
    y: sourceNode.position.y,
  }

  let schemaNodeId: string | undefined

  if (schemaNodeType === 'jsonSchema') {
    schemaNodeId = graphStore.createJsonSchemaNode(schemaPosition, undefined, {
      nodeId: existingV2SchemaId || undefined,
    })
  } else {
    schemaNodeId = graphStore.createSchemaNode(schemaPosition, undefined, {
      nodeId: existingV2SchemaId || undefined,
    })
  }

  if (!schemaNodeId) {
    return { success: false, message: 'shortcuts.feedback.failed' }
  }

  // 等 Vue Flow 渲染新节点、计算 handleBounds，否则创建边时找不到目标端口
  await nextTick()

  // ========== 创建连接边 ==========

  const sourceDataId = (sourceData.id as string) || sourceNode.id
  const sourceHandleId = `${sourceDataId}-output`

  graphStore.createConnection(sourceNode.id, schemaNodeId, sourceHandleId, 'target-left', {
    type: 'smoothstep',
    animated: true,
    style: { stroke: 'var(--edge-data-source)', strokeWidth: 1.5 },
    label: 'Data Source',
  })

  // ========== 维护父子关系 ==========

  const currentChildren = (sourceData.children || []) as string[]
  if (!currentChildren.includes(schemaNodeId)) {
    graphStore.updateNodeData(sourceNode.id, {
      children: [...currentChildren, schemaNodeId],
    } as Partial<CustomNodeData>)
  }

  // ========== 同步数据源信息到 Schema 节点 ==========
  const displayFileName =
    (sourceData.sourceName as string) || (sourceData.fileName as string) || 'Unknown'
  const displaySourcePath =
    (sourceData.localPath as string) || (sourceData.fileName as string) || displayFileName

  if (schemaNodeType === 'jsonSchema') {
    graphStore.updateNodeData(schemaNodeId, {
      ...graphStore.nodes.find((n) => n.id === schemaNodeId)?.data,
      tableName: smartTableName,
      sourceFile: displayFileName,
      sourceFilePath: displaySourcePath,
      sourceType: 'json',
      headerRow: (sourceData.headerRow as number) || 0,
      sourceNodeId: sourceNode.id,
      sourceMode: sourceData.sourceMode as 'localfile',
      localPath: sourceData.localPath as string,
      jsonPath: (sourceData.jsonPath as string) || '',
      recordPath: (sourceData.recordPath as string) || '',
      format: (sourceData.format as 'auto' | 'array' | 'lines' | 'object') || 'auto',
    } as Partial<CustomNodeData>)
  } else {
    graphStore.updateNodeData(schemaNodeId, {
      ...graphStore.nodes.find((n) => n.id === schemaNodeId)?.data,
      tableName: smartTableName,
      sourceFile: displayFileName,
      sourceFilePath: displaySourcePath,
      sourceType: (sourceData.sourceType as 'excel' | 'csv') || 'csv',
      headerRow: (sourceData.headerRow as number) || 0,
      sheetName:
        (sourceData.currentSheet as string) ||
        (sourceData.sourceName as string) ||
        (sourceData.fileName as string),
      sourceNodeId: sourceNode.id,
      sourceMode: sourceData.sourceMode as 'localfile',
      localPath: sourceData.localPath as string,
    } as Partial<CustomNodeData>)
  }

  // ========== 自动触发智能列填充（策略模式）==========
  const previewData = await previewDataFetcher.fetch({ type: 'node', node: sourceNode })

  if (previewData) {
    const schemaNode = graphStore.nodes.find((n) => n.id === schemaNodeId)
    if (schemaNode) {
      try {
        if (schemaNodeType === 'jsonSchema') {
          // JSON: 使用 JsonColumnGenerator
          const existingColumns =
            ((schemaNode.data as Record<string, unknown>)?.columns as unknown[]) || []
          const columns = jsonColumnGenerator.generate(previewData.rawData, existingColumns)

          if (columns.length > 0) {
            graphStore.updateNodeData(schemaNodeId, {
              ...(schemaNode.data || {}),
              columns,
            } as unknown as Partial<CustomNodeData>)
            logger.debug(`✅ [Ctrl+G] JSON 智能列填充完成！共 ${columns.length} 列`)
          }
        } else {
          // Tabular: 使用 TabularColumnGenerator
          const existingColumns =
            (((schemaNode.data || {}) as Record<string, unknown>)?.columns as unknown[]) || []
          const columns = tabularColumnGenerator.generate(previewData.rawData, existingColumns)

          if (columns.length > 0) {
            graphStore.updateNodeData(schemaNodeId, {
              ...(schemaNode.data || {}),
              columns,
            } as unknown as Partial<CustomNodeData>)
            logger.debug(`✅ [Ctrl+G] 智能列填充完成！共 ${columns.length} 列`)
          }
        }
      } catch (error) {
        logger.error('[Ctrl+G] 智能列填充失败:', error)
      }
    }
  }

  // ========== 同步 V2 Schema 资源（约束、正则）==========
  const syncResult = await syncSchemaResources(schemaNodeId)
  if (syncResult.success) {
    logger.debug(
      `✅ [Ctrl+G] 已同步 V2 Schema 资源: 内嵌${syncResult.embeddedCount} 独立${syncResult.independentCount} 正则${syncResult.regexCount}`
    )
  }

  // 选中新创建的 Schema 节点
  graphStore.setSelectedNode(schemaNodeId)

  return { success: true, message: 'shortcuts.feedback.schemaGenerated' }
}
