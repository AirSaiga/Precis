/**
 * @file nodeDeletionManager.ts
 * @description 节点删除管理器
 *
 * 负责处理画布节点的删除逻辑，包括级联删除关联节点、
 * 清理边连接、更新父子关系等。
 *
 * 功能概述：
 * - deleteNodeWithCleanup: 删除单个节点并清理关联边和子节点
 * - deleteNodesWithCleanup: 批量删除节点
 * - 级联删除策略：删除 Schema 节点时，同时删除其关联的 Regex/Constraint 子节点
 * - 边清理：删除与目标节点相连的所有边
 *
 * 架构设计：
 * - 独立于 graphStore，通过组合方式调用 store 方法
 * - 支持可选的确认弹窗（showConfirm）
 * - 使用 i18n 提供本地化删除提示
 */

import { logger } from '@/core/utils/logger'
import { eventBus } from '@/core/eventBus'
import { useGraphStore } from '@/stores/graphStore'
import { useGlobalConfirm } from '@/composables/useGlobalConfirm'
import i18n from '@/i18n'
import type { DataType } from '@/types/graph'
import { isConstraintNodeType } from '@/services/constraints/validationRegistry'
// 模块顶层调用 composable，避免在 class 方法体内调用（违反 Vue composable 规范）。
// useGlobalConfirm 仅操作模块级 ref，无 inject/provide 依赖，模块顶层调用是安全的。
const { showConfirm: _showConfirm } = useGlobalConfirm()

type StrategyType = 'schema' | 'sourcePreview' | 'regex' | 'constraint' | 'transform' | 'default'

function mapNodeKindToStrategy(nodeType: string | undefined): StrategyType {
  if (!nodeType) return 'default'
  if (nodeType === 'projectRoot') return 'default'
  if (nodeType === 'schema' || nodeType === 'jsonSchema') return 'schema'
  if (nodeType === 'sourcePreview' || nodeType === 'jsonSourcePreview') return 'sourcePreview'
  if (nodeType === 'regex') return 'regex'
  if (nodeType === 'transform') return 'transform'
  if (isConstraintNodeType(nodeType)) return 'constraint'
  if (nodeType === 'transformOutput') return 'default'
  if (nodeType === 'manualData') return 'default'
  if (nodeType === 'templateInstance') return 'default'
  if (nodeType === 'pattern' || nodeType === 'patternToolbox') return 'default'
  if (nodeType === 'constraintDashboard') return 'default'
  return 'default'
}

interface SourcePreviewData {
  sourceNodeId: string | null
}

interface ConstraintData {
  schemaNodeId: string
  columnId: string
  type: string
}

interface SchemaColumnData {
  id: string
  constraints?: Record<string, unknown>
  columnName: string
  dataType: DataType
}

interface SchemaData {
  columns?: SchemaColumnData[]
  children?: string[]
}

interface DeleteOptions {
  showConfirm?: boolean
  confirmMessage?: string
  onBeforeDelete?: (nodeId: string, nodeType: StrategyType) => Promise<void> | void
  onAfterDelete?: (nodeId: string, nodeType: StrategyType) => void
}

/**
 * 节点删除管理器类
 *
 * 采用单例模式管理画布节点的删除操作，
 * 通过策略模式处理不同类型节点的级联清理逻辑。
 */
export class NodeDeletionManager {
  private static instance: NodeDeletionManager
  private graphStore = useGraphStore()

  private deletionStrategies: Map<StrategyType, (nodeId: string) => Promise<void>> = new Map()

  private constructor() {
    this.registerDefaultStrategies()
  }

  static getInstance(): NodeDeletionManager {
    if (!NodeDeletionManager.instance) {
      NodeDeletionManager.instance = new NodeDeletionManager()
    }
    return NodeDeletionManager.instance
  }

  registerStrategy(nodeType: StrategyType, strategy: (nodeId: string) => Promise<void>): void {
    this.deletionStrategies.set(nodeType, strategy)
  }

  private registerDefaultStrategies(): void {
    this.deletionStrategies.set('schema', async (nodeId: string) => {
      await this.deleteSchemaNode(nodeId)
    })

    this.deletionStrategies.set('sourcePreview', async (nodeId: string) => {
      await this.deleteSourcePreviewNode(nodeId)
    })

    this.deletionStrategies.set('regex', async (nodeId: string) => {
      await this.deleteRegexNode(nodeId)
    })

    this.deletionStrategies.set('constraint', async (nodeId: string) => {
      await this.deleteConstraintNode(nodeId)
    })

    this.deletionStrategies.set('transform', async (nodeId: string) => {
      await this.deleteTransformNode(nodeId)
    })

    this.deletionStrategies.set('default', async (_nodeId: string) => {})
  }

  private async deleteSchemaNode(nodeId: string): Promise<void> {
    // 清理 sourcePreview 的 sourceNodeId 反向引用（保留原逻辑，与级联删除无关）
    const connectedSources = this.graphStore.edges
      .filter((edge) => edge.target === nodeId && edge.targetHandle === undefined)
      .map((edge) => edge.source)

    connectedSources.forEach((sourceId) => {
      const sourceNode = this.graphStore.nodes.find((n) => n.id === sourceId)
      if (sourceNode?.type === 'sourcePreview') {
        const sourceData = sourceNode.data as SourcePreviewData
        if (sourceData.sourceNodeId === nodeId) {
          this.graphStore.updateNodeData(sourceId, {
            ...sourceData,
            sourceNodeId: undefined,
          })
        }
      }
    })

    // 收集所有指向该 schema 的 constraint 子节点 ID，一次性批量删除。
    // 逐个 deleteNode 会各自触发 removeEdges/removeNodes + 一次 nextTick(reconcileAll)，
    // 产生多次中间不一致状态，并重复 collectCascadeNodeIds 已覆盖的级联收集逻辑；
    // deleteNodes 单次收集所有级联 ID 并在末尾只 reconcile 一次。
    const childConstraintIds = this.graphStore.nodes
      .filter((n) => {
        if (n.type !== 'constraint') return false
        const constraintData = n.data as unknown as ConstraintData
        return constraintData.schemaNodeId === nodeId
      })
      .map((n) => n.id)

    if (childConstraintIds.length > 0) {
      await this.graphStore.deleteNodes(childConstraintIds)
    }
  }

  private async deleteSourcePreviewNode(nodeId: string): Promise<void> {
    const connectedEdge = this.graphStore.edges.find((edge) => edge.source === nodeId)

    if (connectedEdge) {
      const schemaNode = this.graphStore.nodes.find((n) => n.id === connectedEdge.target)
      if (schemaNode?.type === 'schema') {
        eventBus.emit('sourceNodeDisconnected', {
          sourceNodeId: nodeId,
          targetNodeId: connectedEdge.target,
          edgeId: connectedEdge.id,
        })
      }
    }
  }

  private async deleteTransformNode(nodeId: string): Promise<void> {
    const transformNode = this.graphStore.nodes.find((n) => n.id === nodeId)
    if (!transformNode) return

    const transformData = transformNode.data as { outputNodeIds?: string[] }
    // 只收集仍存在于画布上的 transformOutput 子节点，一次性批量删除，
    // 避免逐个 deleteNode 触发多次 reconcileAll 与中间不一致状态（同 deleteSchemaNode）。
    const outputNodeIds = (transformData.outputNodeIds || []).filter((id) =>
      this.graphStore.nodes.some((n) => n.id === id)
    )

    if (outputNodeIds.length > 0) {
      await this.graphStore.deleteNodes(outputNodeIds)
    }
  }

  private async deleteRegexNode(nodeId: string): Promise<void> {
    const regexNode = this.graphStore.nodes.find((n) => n.id === nodeId)
    if (!regexNode) return

    // 不再手动维护父 schema.children ——
    // regex 节点删除时，其入边会被 deleteNodes/deleteNode 内部的 removeEdges 清理，
    // 进而触发 syncOnDisconnect 自动维护父 schema 的 children/parent 关系。
    // 手动维护与 syncOnDisconnect 重复，会导致 transient 不一致（两套写入竞争同一字段）。
    //
    // 保留方法骨架以供未来 regex 特有的反向引用清理扩展。
  }

  private async deleteConstraintNode(nodeId: string): Promise<void> {
    const constraintNode = this.graphStore.nodes.find((n) => n.id === nodeId)
    if (!constraintNode) return

    const constraintData = constraintNode.data as unknown as ConstraintData
    const schemaNodeId = constraintData.schemaNodeId
    const columnId = constraintData.columnId
    const constraintType = constraintData.type

    if (schemaNodeId && columnId) {
      const schemaNode = this.graphStore.nodes.find((n) => n.id === schemaNodeId)
      if (schemaNode?.type === 'schema') {
        const schemaData = schemaNode.data as SchemaData
        const updatedColumns = schemaData.columns?.map((col) => {
          if (col.id === columnId) {
            const constraints = { ...col.constraints }
            delete constraints[constraintType]
            return { ...col, constraints }
          }
          return col
        })

        this.graphStore.updateNodeData(schemaNodeId, {
          ...schemaData,
          columns: updatedColumns,
        })
      }
    }
  }

  async delete(nodeId: string, options: DeleteOptions = {}): Promise<boolean> {
    const { showConfirm = false, confirmMessage, onBeforeDelete, onAfterDelete } = options

    const node = this.graphStore.nodes.find((n) => n.id === nodeId)
    if (!node) {
      logger.warn(`节点不存在: ${nodeId}`)
      return false
    }

    if (node.type === 'projectRoot') {
      logger.warn('无法删除项目根节点')
      return false
    }

    const strategyType = mapNodeKindToStrategy(node.type)

    const message = confirmMessage || this.getConfirmMessage(strategyType)

    if (showConfirm) {
      const confirmed = await _showConfirm({
        title: i18n.global.t('common.confirmDialog.title'),
        message,
        confirmText: i18n.global.t('common.confirm'),
        cancelText: i18n.global.t('common.cancel'),
        type: 'warning',
      })
      if (!confirmed) {
        return false
      }
    }

    if (onBeforeDelete) {
      await onBeforeDelete(nodeId, strategyType)
    }

    const strategy =
      this.deletionStrategies.get(strategyType) || this.deletionStrategies.get('default')!
    await strategy(nodeId)

    await this.graphStore.deleteNode(nodeId)

    if (onAfterDelete) {
      onAfterDelete(nodeId, strategyType)
    }

    return true
  }

  private getConfirmMessage(strategyType: StrategyType): string {
    const t = i18n.global.t
    const messages: Record<StrategyType, string> = {
      schema: t('common.confirmDialog.deleteSchema'),
      sourcePreview: t('common.confirmDialog.deleteSourcePreview'),
      regex: t('common.confirmDialog.deleteRegex'),
      constraint: t('common.confirmDialog.deleteConstraint'),
      transform: t('common.confirmDialog.deleteDefault'),
      default: t('common.confirmDialog.deleteDefault'),
    }

    return messages[strategyType] || messages.default
  }
}
