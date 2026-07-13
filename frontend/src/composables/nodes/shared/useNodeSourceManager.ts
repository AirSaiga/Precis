/**
 * @file useNodeSourceManager.ts
 * @description 节点数据源连接管理通用逻辑
 *
 * 功能概述:
 * - 提供 Schema / JsonSchema 节点与数据源连接的公共逻辑
 * - 支持连接建立、断开、智能填充、列不匹配检测、约束连接处理
 * - 通过选项注入差异行为（节点类型前缀、元数据提取、列生成等）
 *
 * 架构设计:
 * - 各具体节点类型组合式函数调用本通用逻辑后按需扩展特有功能
 * - 生命周期钩子（onMounted / onUnmounted）在内部自动注册事件监听
 *
 * 输入示例:
 * ```ts
 * const generic = useNodeSourceManager(props, emit, {
 *   sourceNodeType: 'sourcePreview',
 *   schemaNodePrefix: 'schema-',
 *   extractMetadata: (sourceNodeId, sourceData) => ({ tableName: 'Sheet1' }),
 *   generateColumns: (sourceNode, existingColumns) => [...],
 *   getSourceFields: (sourceNode) => ['col1', 'col2'],
 *   disconnectFields: ['sourceFile', 'sourceType'],
 *   onSourceDataChanged: (data) => updateNodeFromChange(data),
 * })
 * ```
 *
 * 输出示例:
 * ```ts
 * {
 *   handleSourceConnection,
 *   showSmartFillDialog,
 *   autoGenerateColumns,
 *   checkColumnMismatch,
 *   handleConstraintConnection,
 *   disconnectConstraint,
 *   findConnectedSchemaNodes,
 *   disconnectSource,
 * }
 * ```
 */

import { logger } from '@/core/utils/logger'
import { eventBus } from '@/core/eventBus'
import { onMounted, onUnmounted, toRaw } from 'vue'
import { useI18n } from 'vue-i18n'
import { useVueFlow } from '@vue-flow/core'
import type { Edge } from '@vue-flow/core'
import { useGraphStore } from '@/stores/graphStore'
import { useGlobalConfirm } from '@/composables/useGlobalConfirm'
import { compareColumns } from '@/utils/nodes/schema/columnValidation'
import type { CustomNode, CustomNodeData } from '@/types/nodes'
import type { BaseSchemaNodeData, BaseSchemaColumn } from '@/types/nodes'
import type { AnyRecord } from '@/types/utility'

export interface UseNodeSourceManagerOptions {
  /** 数据源节点类型（用于过滤旧连接） */
  sourceNodeType: string
  /** 目标 schema 节点 ID 前缀（用于查找已连接节点） */
  schemaNodePrefix: string
  /** 从 sourceData 提取元数据并返回需要更新的节点数据字段 */
  extractMetadata: (sourceNodeId: string, sourceData: AnyRecord) => AnyRecord
  /** 列生成函数：传入 sourceNode 和现有列，返回新生成的列数组 */
  generateColumns: (
    sourceNode: CustomNode,
    existingColumns: BaseSchemaColumn[]
  ) => BaseSchemaColumn[]
  /** 获取源数据字段列表（用于列不匹配检测），无数据时返回 undefined */
  getSourceFields: (sourceNode: CustomNode) => string[] | undefined
  /** 断开连接时需要清除的字段名列表 */
  disconnectFields: string[]
  /** 数据源变更后的自定义更新回调（可选） */
  onSourceDataChanged?: (data: AnyRecord) => void
  /** 是否在断开旧连接时重置旧源节点的 outputPortConnected */
  resetOldSourcePort?: boolean
  /** 节点类型标签（用于日志和对话框回退显示） */
  nodeLabel?: string
  /** 列生成成功回调（可选） */
  onColumnsGenerated?: (columns: BaseSchemaColumn[]) => void
  /** 列生成失败回调（可选） */
  onColumnsGenerationFailed?: () => void
  /** 数据源连接成功后的回调（可选） */
  onSourceConnected?: (sourceNodeId: string) => void
}

export function useNodeSourceManager<TNodeData extends BaseSchemaNodeData<BaseSchemaColumn>>(
  props: { id: string; data: TNodeData },
  _emit: unknown,
  options: UseNodeSourceManagerOptions
) {
  const { t } = useI18n()
  const { showConfirm } = useGlobalConfirm()
  const { getConnectedEdges, findNode } = useVueFlow()
  const store = useGraphStore()

  // ============================================================================
  // 核心连接处理
  // ============================================================================

  /**
   * 处理数据源连接
   * 核心流程框架：查找源节点 → 断开旧连接 → 提取元数据 → 更新节点 → 触发智能填充
   */
  const handleSourceConnection = (sourceNodeId: string) => {
    try {
      const sourceNode = store.nodes.find((n: CustomNode) => n.id === sourceNodeId)
      if (!sourceNode) {
        logger.error('未找到数据源节点:', sourceNodeId)
        return
      }

      const sourceData = sourceNode.data as unknown as AnyRecord

      // 1. 查找并断开旧连接
      const existingEdges = store.edges.filter(
        (edge: Edge) =>
          edge.target === props.id &&
          edge.source !== sourceNode.id &&
          store.nodes.find((n: CustomNode) => n.id === edge.source)?.type === options.sourceNodeType
      )

      if (existingEdges.length > 0) {
        logger.debug(
          `🔄 [handleSourceConnection] 断开目标节点的旧数据源连接，数量: ${existingEdges.length}`
        )
        for (const edge of existingEdges) {
          const oldSourceNode = store.nodes.find((n: CustomNode) => n.id === edge.source)
          if (oldSourceNode) {
            const oldData = oldSourceNode.data as Record<string, unknown>
            logger.debug(
              `  - 断开与 "${oldData?.sourceName || oldData?.fileName || oldSourceNode.id}" 的连接`
            )
            if (options.resetOldSourcePort) {
              store.updateNodeData(oldSourceNode.id, {
                ...oldData,
                outputPortConnected: false,
              })
            }
          }
          store.deleteConnection(edge.id)
        }
      }

      // 2. 准备更新数据
      const metadata = options.extractMetadata(sourceNodeId, sourceData)

      // 3. 更新节点元数据
      store.updateNodeData(props.id, { ...props.data, ...metadata } as unknown as TNodeData)
      logger.debug(
        `✅ [handleSourceConnection] 数据源连接成功: ${metadata.sourceFile || 'Unknown'} -> ${metadata.tableName || 'Table'}`
      )

      // 4. 更新源节点状态
      store.updateNodeData(sourceNode.id, {
        ...sourceData,
        outputPortConnected: true,
      } as unknown as Partial<CustomNodeData>)

      // 5. 触发智能填充对话框
      setTimeout(() => {
        const latestSourceNode = store.nodes.find((n: CustomNode) => n.id === sourceNodeId)
        if (latestSourceNode) {
          // node.data 是 Vue reactive proxy，按 AGENTS.md 深拷贝规范用 structuredClone(toRaw(...))
          const sourceDataSnapshot = structuredClone(toRaw(latestSourceNode.data)) as AnyRecord
          showSmartFillDialog({
            id: sourceNodeId,
            data: sourceDataSnapshot,
          } as unknown as CustomNode)
        }

        // onSourceConnected 可能触发 syncSchemaResources 等异步操作，
        // 此处为 intentional fire-and-forget，内部已有 try/catch 保护
        const result = options.onSourceConnected?.(sourceNodeId) as unknown as
          | Promise<unknown>
          | undefined
        result?.catch?.((err: unknown) =>
          logger.error('❌ [handleSourceConnection] onSourceConnected 回调失败:', err)
        )
      }, 100)
    } catch (err) {
      logger.error('❌ [handleSourceConnection] 处理数据源连接失败:', err)
    }
  }

  // ============================================================================
  // 断开连接
  // ============================================================================

  /**
   * 断开数据源连接（通用版）
   * 1. 移除 Schema → SourcePreview 的边（触发 watcher → handleEdgeRemoved → 注册表清理）
   * 2. 清除 disconnectFields 中的元数据字段
   */
  const disconnectSource = () => {
    // 找到并移除当前节点作为 target 的数据源连接边
    const connectedEdges = store.edges.filter(
      (e: Edge) => e.target === props.id && e.targetHandle === 'target-left'
    )
    for (const edge of connectedEdges) {
      store.deleteConnection(edge.id)
    }

    // 清除元数据字段
    const updates: Record<string, unknown> = {}
    for (const field of options.disconnectFields) {
      updates[field] = undefined
    }
    store.updateNodeData(props.id, { ...props.data, ...updates } as unknown as TNodeData)
  }

  // ============================================================================
  // 智能填充对话框
  // ============================================================================

  /**
   * 显示智能填充询问对话框（三分支决策）
   */
  const showSmartFillDialog = async (sourceNode: CustomNode) => {
    const sourceData = sourceNode.data as unknown as AnyRecord
    const sourceName =
      (sourceData.sourceName as string | undefined) ||
      (sourceData.fileName as string | undefined) ||
      'Unknown'
    const schemaName = props.data.tableName || options.nodeLabel || 'Schema'

    // 提取数据源列名用于比较
    const sourceFields = options.getSourceFields(sourceNode)
    if (!sourceFields || sourceFields.length === 0) return

    const schemaColumns = (props.data.columns || []) as {
      columnName: string
      expressionType?: string
      isBound?: boolean
      extractedConfig?: unknown
    }[]
    const comparison = compareColumns(sourceFields, schemaColumns)

    logger.debug('🎯 [showSmartFillDialog] 列比较结果:', comparison)

    if (comparison.schemaEmpty) {
      // ── Case A: Schema 无列定义 → 弹"生成"对话框 ──
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
        autoGenerateColumns(sourceNode)
      }
    } else if (comparison.needsAction) {
      // ── Case B: 列不匹配 → 弹"修正"对话框（三按钮） ──
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
        autoGenerateColumns(sourceNode)
      }
    } else {
      // ── Case C: 列完全匹配 → 静默跳过 ──
      logger.debug('🎯 [showSmartFillDialog] 列定义已匹配数据源，跳过智能填充')
    }
  }

  // ============================================================================
  // 列不匹配检测
  // ============================================================================

  /**
   * 检查数据源列名与 Schema 定义是否匹配
   */
  const checkColumnMismatch = async (sourceNode: CustomNode) => {
    const sourceFields = options.getSourceFields(sourceNode)
    if (!sourceFields || sourceFields.length === 0) return

    const schemaColumns = props.data.columns || []
    if (schemaColumns.length === 0) return

    const missingColumns = schemaColumns
      .map((c: BaseSchemaColumn) => c.columnName)
      .filter((name: string) => !sourceFields.includes(name))

    if (missingColumns.length > 0) {
      const missingCount = missingColumns.length
      const previewMissing = missingColumns.slice(0, 5).join(', ')
      const suffix = missingColumns.length > 5 ? '...' : ''

      logger.warn(`⚠️ 列不匹配警告: 缺少 ${missingCount} 列`, missingColumns)

      await showConfirm({
        title: t('canvas.nodeCanvas.columnMismatch.title'),
        message: t('canvas.nodeCanvas.columnMismatch.message', {
          schemaCount: schemaColumns.length,
          missingCount,
          missingColumns: `${previewMissing}${suffix}`,
        }),
        confirmText: t('canvas.nodeCanvas.columnMismatch.confirm'),
        cancelText: t('common.cancel'),
      })
    }
  }

  // ============================================================================
  // 自动列生成
  // ============================================================================

  /**
   * 从数据源自动生成列定义
   * @returns 生成的列数组（失败时返回 undefined）
   */
  const autoGenerateColumns = (sourceNode: CustomNode): BaseSchemaColumn[] | undefined => {
    try {
      logger.debug('🔄 开始生成列定义（智能保留模式）...', {
        sourceNodeId: sourceNode.id,
        schemaNodeId: props.id,
        sourceData: sourceNode.data,
      })

      const columns = options.generateColumns(sourceNode, props.data.columns || [])
      if (!columns) {
        logger.error('数据源为空或列生成失败，无法生成列定义')
        options.onColumnsGenerationFailed?.()
        return undefined
      }

      store.updateNodeData(props.id, { ...props.data, columns })
      logger.debug(`✅ 智能列生成完成！共 ${columns.length} 列`)
      options.onColumnsGenerated?.(columns)
      return columns
    } catch (err) {
      logger.error('自动生成列定义失败:', err)
      options.onColumnsGenerationFailed?.()
      return undefined
    }
  }

  // ============================================================================
  // 约束连接处理
  // ============================================================================

  /**
   * 处理约束连接
   */
  const handleConstraintConnection = (constraintNode: CustomNode, columnId: string) => {
    logger.debug(`🔄 约束连接: ${constraintNode.id} -> ${props.id}.${columnId}`)
  }

  /**
   * 断开约束连接
   */
  const disconnectConstraint = (constraintId: string, columnId?: string) => {
    const edgesToRemove = store.edges.filter(
      (e: Edge) => e.source === constraintId && e.target === props.id
    )

    edgesToRemove.forEach((edge: Edge) => {
      store.deleteConnection(edge.id)
      logger.debug(`  - 已删除边: ${edge.id}`)
    })

    if (columnId) {
      const column = props.data.columns?.find((c: BaseSchemaColumn) => c.id === columnId)
      if (column && column.constraints) {
        const constraints = { ...column.constraints }
        delete constraints.notNull
        delete constraints.unique

        store.updateNodeData(props.id, {
          ...props.data,
          columns: props.data.columns.map((c: BaseSchemaColumn) =>
            c.id === columnId ? { ...c, constraints } : c
          ),
        })
        logger.debug(`  - 已清除列 ${columnId} 的约束标记`)
      }
    }

    logger.debug(
      `🔄 已断开约束连接: ${constraintId} -> ${props.id}，共 ${edgesToRemove.length} 条边`
    )
  }

  // ============================================================================
  // 事件监听
  // ============================================================================

  /**
   * 处理源数据变更事件
   */
  const handleSourcePreviewDataChanged = (detail: {
    nodeId: string
    data: Record<string, unknown>
  }) => {
    const { nodeId, data } = detail

    const isConnected = store.edges.some(
      (edge) => edge.source === nodeId && edge.target === props.id
    )

    if (isConnected) {
      logger.debug(`📥 检测到关联源节点 ${nodeId} 数据变更，更新节点 ${props.id}`)
      options.onSourceDataChanged?.(data)
    }
  }

  onMounted(() => {
    // 数据源预览数据变更事件统一为 'sourcePreviewDataChanged'(sourcePreview 与
    // jsonSourcePreview 节点共用 usePreviewData,emit 端固定用此事件名)。
    // handleSourcePreviewDataChanged 内部通过 edge.source===nodeId 过滤,确保
    // 每个 schema 节点只响应连到自己的源节点,不会串扰。
    eventBus.on('sourcePreviewDataChanged', handleSourcePreviewDataChanged)
  })

  onUnmounted(() => {
    eventBus.off('sourcePreviewDataChanged', handleSourcePreviewDataChanged)
  })

  // ============================================================================
  // 辅助方法
  // ============================================================================

  /**
   * 查找已连接的 Schema 节点
   */
  const findConnectedSchemaNodes = (sourceNodeId: string) => {
    const sourceNode = findNode(sourceNodeId)
    if (!sourceNode) {
      return []
    }

    const connectedEdges = getConnectedEdges([sourceNode])

    const schemaNodeIds = connectedEdges
      .filter((edge) => edge.target.startsWith(options.schemaNodePrefix))
      .map((edge) => edge.target)

    return store.nodes.filter((node) => schemaNodeIds.includes(node.id))
  }

  return {
    handleSourceConnection,
    disconnectSource,
    showSmartFillDialog,
    autoGenerateColumns,
    checkColumnMismatch,
    handleConstraintConnection,
    disconnectConstraint,
    findConnectedSchemaNodes,
    handleSourcePreviewDataChanged,
  }
}
