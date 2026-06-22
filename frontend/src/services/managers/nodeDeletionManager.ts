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
import type { Edge } from '@vue-flow/core'
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- 当前未使用，保留以支持后续扩展或模板使用
interface RegexData {
  sourceNodeId?: string
  sourceColumnName?: string
  inputFromNode?: string
  inputColumn?: string
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

    const constraintNodes = this.graphStore.nodes.filter((n) => n.type === 'constraint')
    for (const constraintNode of constraintNodes) {
      const constraintData = constraintNode.data as unknown as ConstraintData
      if (constraintData.schemaNodeId === nodeId) {
        this.graphStore.deleteNode(constraintNode.id)
      }
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
    const outputNodeIds = transformData.outputNodeIds || []

    // 级联删除绑定的 transformOutput 子节点
    for (const outputId of outputNodeIds) {
      const outputNode = this.graphStore.nodes.find((n) => n.id === outputId)
      if (outputNode) {
        this.graphStore.deleteNode(outputId)
      }
    }
  }

  private async deleteRegexNode(nodeId: string): Promise<void> {
    const regexNode = this.graphStore.nodes.find((n) => n.id === nodeId)
    if (!regexNode) return

    // 清理父 Schema 节点的 children 引用（通过 incoming edge 查找）
    const incomingEdge = this.graphStore.edges.find(
      (e: Edge) => e.target === nodeId && (e.targetHandle === 'regex-input' || !e.targetHandle)
    )
    const sourceNodeId = incomingEdge?.source as string | undefined
    if (sourceNodeId) {
      const schemaNode = this.graphStore.nodes.find((n) => n.id === sourceNodeId)
      if (schemaNode?.type === 'schema') {
        const schemaData = schemaNode.data as SchemaData
        const updatedChildren = (schemaData.children || []).filter((id) => id !== nodeId)
        this.graphStore.updateNodeData(sourceNodeId, {
          ...schemaData,
          children: updatedChildren,
        })
      }
    }
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

    this.graphStore.deleteNode(nodeId)

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
