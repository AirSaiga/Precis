/**
 * @file generateSchema.ts
 * @description 从数据源生成 Schema 处理器
 *
 * 功能概述：
 * - 根据选中数据源节点类型自动创建对应 Schema 节点
 * - 建立数据源到 Schema 的连接边
 * - 同步数据源元数据并自动触发智能列填充
 */

import { nextTick } from 'vue'
import { logger } from '@/core/utils/logger'
import { useGraphStore } from '@/stores/graphStore'
import { generateColumnsFromSource } from '@/utils/nodes/schema/columnGeneration'
import { generateJsonColumnsFromSource } from '@/utils/nodes/json/columnGeneration'

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

export async function generateSchemaFromSource(): Promise<{ success: boolean; message?: string }> {
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

  // ========== 创建 Schema 节点 ==========

  const schemaPosition = {
    x: sourceNode.position.x + 450,
    y: sourceNode.position.y,
  }

  let schemaNodeId: string | undefined

  if (schemaNodeType === 'jsonSchema') {
    // JSON 数据源 → 创建 JsonSchema 节点
    schemaNodeId = graphStore.createJsonSchemaNode(schemaPosition)
  } else {
    // Excel/CSV 数据源 → 创建普通 Schema 节点
    schemaNodeId = graphStore.createSchemaNode(schemaPosition)
  }

  if (!schemaNodeId) {
    return { success: false, message: 'shortcuts.feedback.failed' }
  }

  // 等 Vue Flow 渲染新节点、计算 handleBounds，否则创建边时找不到目标端口
  await nextTick()

  // ========== 创建连接边 ==========

  // Handle ID 约定：output handle 使用 data.id（与 Vue 组件中 :id="`${localData.id}-output`" 一致）
  const sourceDataId =
    ((sourceNode.data as unknown as Record<string, unknown>)?.id as string) || sourceNode.id
  const sourceHandleId = `${sourceDataId}-output`

  graphStore.createConnection(sourceNode.id, schemaNodeId, sourceHandleId, 'target-left', {
    type: 'smoothstep',
    animated: true,
    style: { stroke: 'var(--edge-data-source)', strokeWidth: 1.5 },
    label: 'Data Source',
  })

  // ========== 维护父子关系 ==========

  const sourceData = sourceNode.data as unknown as Record<string, unknown>
  const currentChildren = (sourceData.children || []) as string[]
  if (!currentChildren.includes(schemaNodeId)) {
    graphStore.updateNodeData(sourceNode.id, {
      children: [...currentChildren, schemaNodeId],
    })
  }

  // ========== 同步数据源信息到 Schema 节点 ==========
  // 手动设置 sourceFile、sourceFilePath 等字段，这些字段是字符集约束节点校验时必需的
  const displayFileName =
    (sourceData.sourceName as string) || (sourceData.fileName as string) || 'Unknown'
  const smartTableName =
    (sourceData.currentSheet as string) ||
    ((sourceData.sourceName as string) || (sourceData.fileName as string) || 'Table').replace(
      /\.[^/.]+$/,
      ''
    )
  const displaySourcePath =
    (sourceData.localPath as string) || (sourceData.fileName as string) || displayFileName

  // 根据 Schema 类型设置不同的字段
  if (schemaNodeType === 'jsonSchema') {
    // JSON Schema 特有字段
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
      format: (sourceData.format as 'json' | 'jsonl' | 'ndjson') || 'json',
    })
  } else {
    // 普通 Schema (Excel/CSV) 字段
    graphStore.updateNodeData(schemaNodeId, {
      ...graphStore.nodes.find((n) => n.id === schemaNodeId)?.data,
      tableName: smartTableName,
      sourceFile: displayFileName,
      sourceFilePath: displaySourcePath,
      sourceType: 'json' as const,
      headerRow: (sourceData.headerRow as number) || 0,
      sheetName:
        (sourceData.currentSheet as string) ||
        (sourceData.sourceName as string) ||
        (sourceData.fileName as string),
      sourceNodeId: sourceNode.id,
      sourceMode: sourceData.sourceMode as 'localfile',
      localPath: sourceData.localPath as string,
    })
  }

  // ========== 自动触发智能列填充 ==========
  // 根据 Schema 类型，从数据源自动生成列定义
  if (schemaNodeType === 'jsonSchema') {
    // JSON 数据源：从 rawData 自动生成列定义
    const rawData = sourceData.rawData
    if (rawData && Array.isArray(rawData) && (rawData as unknown[]).length > 0) {
      try {
        const columns = generateJsonColumnsFromSource(rawData, [], { forceReinferTypes: true })
        const currentData = graphStore.nodes.find((n) => n.id === schemaNodeId)?.data
        if (currentData && columns.length > 0) {
          graphStore.updateNodeData(schemaNodeId, { ...currentData, columns })
          logger.debug(`✅ [Ctrl+G] JSON 智能列填充完成！共 ${columns.length} 列`)
        }
      } catch (error) {
        logger.error('[Ctrl+G] JSON 智能列填充失败:', error)
      }
    }
  } else {
    // Excel/CSV 数据源：从表头行自动生成列定义
    const tableData = sourceData.data as unknown[][] | undefined
    if (tableData && tableData.length > 0) {
      try {
        const headerRowIndex = (sourceData.headerRow as number) ?? 0
        const headerRow = tableData[headerRowIndex]
        if (headerRow) {
          const sampleDataRow =
            headerRowIndex + 1 < tableData.length ? tableData[headerRowIndex + 1] : undefined
          const columns = generateColumnsFromSource(headerRow, [], sampleDataRow, {
            forceReinferTypes: true,
          })
          const currentData = graphStore.nodes.find((n) => n.id === schemaNodeId)?.data
          if (currentData && columns.length > 0) {
            graphStore.updateNodeData(schemaNodeId, { ...currentData, columns })
            logger.debug(`✅ [Ctrl+G] 智能列填充完成！共 ${columns.length} 列`)
          }
        }
      } catch (error) {
        logger.error('[Ctrl+G] 智能列填充失败:', error)
      }
    }
  }

  // 选中新创建的 Schema 节点
  graphStore.setSelectedNode(schemaNodeId)

  return { success: true, message: 'shortcuts.feedback.schemaGenerated' }
}
