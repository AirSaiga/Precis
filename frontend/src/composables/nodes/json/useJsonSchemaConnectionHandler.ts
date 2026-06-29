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
import { useVueFlow } from '@vue-flow/core'
import type { Edge } from '@vue-flow/core'

import { useGraphStore } from '@/stores/graphStore'
import { useProjectStore } from '@/stores/projectStore'
import { useGlobalConfirm } from '@/composables/useGlobalConfirm'
import { useToast } from '@/composables/shared/useToast'
import { generateJsonColumnsFromSource } from '@/utils/nodes/json/columnGeneration'
import { findMatchingJsonSchema } from '@/utils/nodes/json/findMatchingJsonSchema'
import { compareColumns } from '@/utils/nodes/schema/columnValidation'
import { getV2FullConfig } from '@/api/projectV2Api'
import { materializeV2EmbeddedConstraints } from '@/stores/graphStore/modules/v2/shared/embeddedConstraints'
import { addNodes } from '@/services/canvas/vueFlowApi'
import { triggerValidationForNode } from '@/services/constraints/orchestration/globalValidation'
import { revalidateConstraintsReferencingSchema } from '@/services/constraints/validationRegistryCore'
import { resolveRelativePath } from '@/core/utils/pathNormalization'
import { toastWarning } from '@/core/toast'
import { i18n } from '@/i18n'
import type {
  CustomNode,
  JsonSchemaColumn,
  JsonSchemaNodeData,
  JsonSourcePreviewNodeData,
} from '@/types/nodes'
import type { TableSchemaFileV2 } from '@/types/projectV2'

/**
 * 允许传入完整节点对象或节点 data 对象的通用输入类型
 */
type NodeInput<T> = { id?: string; data?: T } | T

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
  const info = toast.info

  const store = useGraphStore()

  /** 从 V2 配置的 columns 递归还原 JsonSchemaColumn(含 children) */
  function convertJsonColumnsFromConfig(columns: TableSchemaFileV2['columns']): JsonSchemaColumn[] {
    return (columns || []).map((col) => {
      const converted: JsonSchemaColumn = {
        id: col.id ?? col.name,
        columnName: col.name,
        jsonPath: col.json_path ?? `$.${col.name}`,
        dataType: (col.type as JsonSchemaColumn['dataType']) || 'string',
        // 保留后端配置的 nullable(默认 true,与后端 ColumnSpec.nullable 一致)
        nullable: col.nullable !== false,
      }
      // 递归还原嵌套子列
      if (col.children && col.children.length > 0) {
        converted.children = convertJsonColumnsFromConfig(col.children)
      }
      return converted
    })
  }

  /** 从已保存的 V2 配置恢复 JSON Schema 的列定义 + 物化内嵌约束 */
  async function tryLoadJsonSchemaConfig(params: {
    schemaNodeId: string
    localPath: string | undefined
    recordPath: string | undefined | null
    configPath: string | undefined
    store: ReturnType<typeof useGraphStore>
    updateNodeInternals: (nodeIds?: string[]) => void
  }): Promise<boolean> {
    const { schemaNodeId, localPath, recordPath, configPath, store, updateNodeInternals } = params
    if (!localPath || !configPath) return false

    const resolvedLocalPath = resolveRelativePath(localPath, configPath) ?? localPath

    let fullConfig: Awaited<ReturnType<typeof getV2FullConfig>>
    try {
      fullConfig = await getV2FullConfig(configPath)
    } catch {
      logger.debug('🔌 [tryLoadJsonSchemaConfig] 无法加载 V2 配置')
      return false
    }

    const schemas = fullConfig.schemas || {}
    const match = findMatchingJsonSchema(schemas, resolvedLocalPath, recordPath, configPath)
    if (!match) {
      logger.debug(
        `🔌 [tryLoadJsonSchemaConfig] 未找到匹配的 schema (localPath=${localPath}, recordPath=${recordPath})`
      )
      return false
    }

    const { id: tableId, schema: schemaFile } = match
    const cols = convertJsonColumnsFromConfig(schemaFile.columns || [])

    store.updateNodeData(schemaNodeId, {
      columns: cols,
      saveState: 'saved',
    } as unknown as Record<string, unknown>)

    if (schemaNodeId !== tableId) {
      store.updateNodeData(schemaNodeId, {
        configName: tableId,
        saveState: 'modified',
      } as unknown as Record<string, unknown>)
      logger.warn(
        `[tryLoadJsonSchemaConfig] schema node ID ${schemaNodeId} differs from file ID ${tableId}`
      )
    }

    // 检测重复数据源(JSON 用 recordPath 作为额外键)
    const sourcePath = schemaFile.source?.path
    if (
      sourcePath &&
      store.schemaSourceIndex?.isDuplicateSource(sourcePath, recordPath ?? undefined, schemaNodeId)
    ) {
      const conflict = store.schemaSourceIndex.getConflictForSource(
        sourcePath,
        recordPath ?? undefined,
        schemaNodeId
      )
      const otherIds = conflict?.nodeIds.filter((id) => id !== schemaNodeId) || []
      toastWarning(
        i18n.global.t('canvas.nodeCanvas.duplicateSourceMessage', {
          source: sourcePath,
          nodes: otherIds.join(', '),
        }),
        i18n.global.t('canvas.nodeCanvas.duplicateSourceTitle')
      )
    }
    store.schemaSourceIndex?.rebuild()

    await nextTick()
    updateNodeInternals([schemaNodeId])

    // 物化内嵌约束(复用已支持 jsonSchema 的 materializeV2EmbeddedConstraints)
    const schemaNode = store.nodes.find((n: CustomNode) => n.id === schemaNodeId)
    if (!schemaNode) return true

    const schemaData = schemaNode.data as unknown as JsonSchemaNodeData
    // 递归构建 columnName -> columnId 映射(含嵌套)
    const colNameToId = new Map<string, string>()
    const walkNames = (cols: JsonSchemaColumn[]) => {
      for (const c of cols) {
        colNameToId.set(c.columnName, c.id)
        if (c.children) walkNames(c.children)
      }
    }
    walkNames(schemaData.columns || [])

    const embedded = Array.isArray(schemaFile.constraints) ? schemaFile.constraints : []
    if (embedded.length > 0) {
      const bufferedEdges: Array<{
        tableId: string
        constraintId: string
        columnId: string
      }> = []

      materializeV2EmbeddedConstraints({
        schemaNode: schemaNode as unknown as import('@/types/graph').CustomNode,
        schemaTableName: schemaData.tableName,
        embeddedConstraints: embedded as Parameters<
          typeof materializeV2EmbeddedConstraints
        >[0]['embeddedConstraints'],
        colNameToId,
        hasNode: (id: string) => store.nodes.some((n) => n.id === id),
        addNode: (node: import('@/types/graph').CustomNode) => addNodes(node),
        addConstraintEdge: (tId: string, cId: string, colId: string) => {
          bufferedEdges.push({ tableId: tId, constraintId: cId, columnId: colId })
        },
      })

      await nextTick()
      updateNodeInternals([schemaNodeId])
      // 建边前去重,与 syncJsonSchemaResources 保持对称,防御 onSourceConnected 与
      // tryLoadJsonSchemaConfig 触发边界变化时产生重复边
      for (const edge of bufferedEdges) {
        if (store.edges.some((e) => e.source === edge.tableId && e.target === edge.constraintId)) {
          continue
        }
        store.createConnection(
          edge.tableId,
          edge.constraintId,
          `source-right-${edge.columnId}`,
          `target-input-${edge.constraintId}`
        )
      }
    }

    logger.debug(
      `🔌 [tryLoadJsonSchemaConfig] 已从 V2 恢复: ${cols.length} 列, ${embedded.length} 内嵌约束`
    )
    return true
  }

  /**
   * 显示智能填充询问对话框
   * 询问用户是否要根据 JSON 数据源自动生成列定义
   *
   * @param sourceNode - 数据源节点（包含 id 和 data）
   * @param schemaNode - Schema 节点（包含 id 和 data）
   * @returns 是否执行了列生成操作
   */
  const showSmartFillDialog = async (
    sourceNode: NodeInput<JsonSourcePreviewNodeData>,
    schemaNode: NodeInput<JsonSchemaNodeData>
  ) => {
    const sourceData = ((sourceNode as { data?: unknown }).data ??
      sourceNode) as unknown as JsonSourcePreviewNodeData
    const schemaData = ((schemaNode as { data?: unknown }).data ??
      schemaNode) as unknown as JsonSchemaNodeData

    const sourceName = sourceData?.sourceName || sourceData?.fileName || 'Unknown'
    const schemaName = schemaData?.tableName || 'JsonSchema'

    const rawData = sourceData?.rawData
    if (!rawData || !Array.isArray(rawData) || rawData.length === 0) {
      logger.warn('🎯 [showSmartFillDialog] JSON rawData 为空，跳过智能填充')
      info(t('canvas.nodeCanvas.jsonSourceEmpty'))
      return false
    }

    const firstRecord: unknown = rawData[0]
    if (!firstRecord || typeof firstRecord !== 'object') {
      logger.warn('🎯 [showSmartFillDialog] JSON 第一条记录不是对象，跳过智能填充')
      info(t('canvas.nodeCanvas.jsonSourceInvalid'))
      return false
    }

    const sourceColumnNames = Object.keys(firstRecord)

    const schemaColumns = schemaData?.columns || []
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
        generateColumnsFromSource((schemaNode as { id: string }).id, sourceData)
        return true
      }
    } else if (comparison.needsAction) {
      const parts: string[] = []
      if (comparison.newInSource.length > 0) {
        const preview = comparison.newInSource.slice(0, 5).join(', ')
        const suffix =
          comparison.newInSource.length > 5 ? ` 等 ${comparison.newInSource.length} 个` : ''
        parts.push(
          t('canvas.nodeCanvas.smartFix.newInSource', {
            count: comparison.newInSource.length,
            columns: `${preview}${suffix}`,
          })
        )
      }
      if (comparison.staleInSchema.length > 0) {
        const preview = comparison.staleInSchema.slice(0, 5).join(', ')
        const suffix =
          comparison.staleInSchema.length > 5 ? ` 等 ${comparison.staleInSchema.length} 个` : ''
        parts.push(
          t('canvas.nodeCanvas.smartFix.staleInSchema', {
            count: comparison.staleInSchema.length,
            columns: `${preview}${suffix}`,
          })
        )
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

      logger.debug(
        '🎯 [showSmartFillDialog] 用户选择:',
        result === true ? '✅ 智能修正' : '❌ 跳过/取消'
      )

      if (result === true) {
        generateColumnsFromSource((schemaNode as { id: string }).id, sourceData)
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
  const generateColumnsFromSource = (
    schemaNodeId: string,
    sourceNodeData: JsonSourcePreviewNodeData
  ) => {
    logger.debug('🎯 [generateColumnsFromSource] 开始生成 JSON 列定义！')
    logger.debug('  - schemaNodeId:', schemaNodeId)

    const schemaNode = store.nodes.find((n: CustomNode) => n.id === schemaNodeId)
    if (!schemaNode) {
      throw new Error(`Schema 节点 ${schemaNodeId} 不存在`)
    }

    const schemaData = schemaNode.data as unknown as JsonSchemaNodeData
    const sourceData = sourceNodeData
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

    const sourcePreviewNode = store.nodes.find((n: CustomNode) => n.id === sourcePreviewNodeId)
    const schemaNode = store.nodes.find((n: CustomNode) => n.id === schemaNodeId)
    if (!sourcePreviewNode || !schemaNode) {
      throw new Error('源节点或目标节点不存在')
    }

    logger.debug('🔌 [handleSourceConnection] 开始处理 JSON 连接')
    logger.debug(
      '  - jsonSchemaNode 当前列定义数量:',
      (schemaNode.data as unknown as JsonSchemaNodeData).columns?.length || 0
    )

    const sourceData = sourcePreviewNode.data as unknown as JsonSourcePreviewNodeData

    const displayFileName = sourceData.sourceName || sourceData.fileName || 'Unknown'

    const existingEdges = store.edges.filter(
      (edge: Edge) =>
        edge.target === schemaNodeId &&
        edge.source !== sourcePreviewNodeId &&
        store.nodes.find((n: CustomNode) => n.id === edge.source)?.type === 'jsonSourcePreview'
    )

    if (existingEdges.length > 0) {
      logger.debug(`🔄 断开目标 JsonSchemaNode 的旧数据源连接，数量: ${existingEdges.length}`)

      for (const edge of existingEdges) {
        const oldSourceNode = store.nodes.find((n: CustomNode) => n.id === edge.source)
        if (oldSourceNode) {
          logger.debug(
            `  - 断开与 "${
              (oldSourceNode.data as unknown as Record<string, unknown>)?.sourceName ||
              (oldSourceNode.data as unknown as Record<string, unknown>)?.fileName ||
              oldSourceNode.id
            }" 的连接`
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

    logger.debug('🔌 [handleSourceConnection] 连接处理完成，准备恢复配置或弹出确认对话框')

    const { updateNodeInternals } = useVueFlow()
    const projectStore = useProjectStore()
    const configPath = projectStore.currentPaths?.configPath

    // 步骤4:尝试从 V2 配置恢复
    const loadedFromConfig = await tryLoadJsonSchemaConfig({
      schemaNodeId,
      localPath: sourceData.localPath,
      recordPath: sourceData.recordPath,
      configPath,
      store,
      updateNodeInternals,
    })

    if (!loadedFromConfig) {
      // 未恢复则回退智能填充对话框
      await nextTick()
      const latestSourceNode = store.nodes.find((n: CustomNode) => n.id === sourcePreviewNodeId)
      const latestSchemaNode = store.nodes.find((n: CustomNode) => n.id === schemaNodeId)

      if (latestSourceNode && latestSchemaNode) {
        try {
          const sourceDataSnapshot: JsonSourcePreviewNodeData = JSON.parse(
            JSON.stringify(latestSourceNode.data as unknown as JsonSourcePreviewNodeData)
          )
          await showSmartFillDialog(
            { id: sourcePreviewNodeId, data: sourceDataSnapshot },
            { id: schemaNodeId, data: latestSchemaNode.data as unknown as JsonSchemaNodeData }
          )
        } catch (error: unknown) {
          if (
            error instanceof Error &&
            (error.message.includes('JSON 数据源为空') || error.message.includes('格式不正确'))
          ) {
            logger.warn('🎯 [handleSourceConnection] 智能填充业务跳过:', error.message)
          } else {
            throw error
          }
        }
      }
    }

    // 步骤5:触发全局约束校验 + 重验引用该 schema 的约束
    const currentSchemaNode = store.nodes.find((n: CustomNode) => n.id === schemaNodeId)
    const hasColumns = (currentSchemaNode?.data as unknown as JsonSchemaNodeData)?.columns?.length
    if (currentSchemaNode && hasColumns) {
      triggerValidationForNode(
        schemaNodeId,
        store.nodes,
        store.edges,
        (nodeId: string, data: Record<string, unknown>) => store.updateNodeData(nodeId, data)
      )
    }

    await revalidateConstraintsReferencingSchema({
      schemaNodeId,
      nodes: store.nodes,
      edges: store.edges,
      updateNodeData: (nodeId: string, data: Record<string, unknown>) =>
        store.updateNodeData(nodeId, data),
    })
  }

  return {
    showSmartFillDialog,
    handleSourceConnection,
    generateColumnsFromSource,
  }
}
