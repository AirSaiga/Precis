/**
 * @file aiChatInstructionService.ts
 * @description AI 聊天前端指令处理服务
 *
 * 职责：
 * - 解析 AI 返回的前端渲染指令
 * - 在画布上创建约束节点、连线或内嵌约束
 * - 与 graphStore 和 Vue Flow 交互
 *
 * 指令类型：
 * - 普通约束节点：isInline=false，在目标节点右侧创建独立约束节点并连线
 * - 内嵌约束：isInline=true，将约束附加到目标节点的列定义上
 *
 * 副作用：
 * - 修改 graphStore.nodes 和 graphStore.edges
 * - 调用 fitView() 影响画布视口
 */

import { logger } from '@/core/utils/logger'
import { toastError, toastSuccess } from '@/core/toast'
import { useVueFlow } from '@vue-flow/core'
import type { Edge, Node as VueFlowNode } from '@vue-flow/core'
import { v4 as uuidv4 } from 'uuid'
import { useGraphStore } from '@/stores/graphStore'
import { useI18n } from 'vue-i18n'
import type { FrontendInstruction } from '@/stores/aiChatStore'

/**
 * AI 返回的约束类型到前端节点类型的映射表
 *
 * AI 使用大写下划线格式（如 NOT_NULL），前端节点类型使用 camelCase（如 notNullConstraint）。
 * 注意：REGEX 映射为 'regex'，对应 regex 节点而非约束节点。
 */
const CONSTRAINT_TYPE_MAP: Record<string, string> = {
  NOT_NULL: 'notNull',
  UNIQUE: 'unique',
  ALLOWED_VALUES: 'allowedValues',
  RANGE: 'range',
  REGEX: 'regex',
}

/**
 * 处理前端渲染指令，在画布上创建约束节点和连线
 *
 * 遍历每条指令，根据 isInline 标志决定创建独立约束节点还是内嵌约束。
 * 独立约束节点创建在目标节点右侧 350px 位置，并自动连线。
 * 处理完成后通过 fitView 将视口聚焦到新创建的节点。
 *
 * @param instructions - AI 返回的前端渲染指令数组
 * @returns Promise，所有指令处理完成后 resolve
 */
export async function processFrontendInstructions(
  instructions: FrontendInstruction[]
): Promise<void> {
  if (!instructions || instructions.length === 0) return

  const { t } = useI18n()
  const graphStore = useGraphStore()
  const { fitView } = useVueFlow()

  for (const instruction of instructions) {
    const { constraintSpec } = instruction
    const { type, targetNodeId, tableName, targetColumn, constraintId, isInline } = constraintSpec

    // 在 graphStore 中查找 AI 指定的目标表节点
    const targetNode = graphStore.nodes.find((n) => n.id === targetNodeId)

    if (!targetNode) {
      logger.warn(`[AI Chat] 目标节点不存在: ${targetNodeId}`)
      toastError(t('aiChat.targetNodeNotFound'))
      continue
    }

    // 内嵌约束：直接附加到目标节点的列定义，不创建独立节点
    if (isInline) {
      await handleInlineConstraint(targetNode, type, targetColumn, constraintId)
      toastSuccess(t('aiChat.inlineConstraintCreated', { table: tableName, column: targetColumn }))
      continue
    }

    // 独立约束节点：在目标节点右侧创建新节点并连线
    const constraintType = CONSTRAINT_TYPE_MAP[type] || 'notNull'
    const nodePosition = {
      x: targetNode.position.x + 350,
      y: targetNode.position.y,
    }

    const constraintNodeId = uuidv4()
    const constraintNode: VueFlowNode = {
      id: constraintNodeId,
      type: `${constraintType}Constraint`,
      position: nodePosition,
      data: {
        configName: `${constraintId}`,
        table: tableName,
        column: targetColumn,
        constraintName: constraintId,
        validationStatus: 'idle',
        validationErrors: [],
        lastValidation: undefined,
        sourceRef: undefined,
      },
    }

    // 注意：此处直接 push 到 graphStore.nodes 是因为 AI 指令处理发生在用户交互回调中，
    // 且 graphStore 内部通过 Vue Flow 的 v-model 机制同步。与批量导入场景不同，单节点添加可直接 push。
    graphStore.nodes.push(constraintNode)

    const edgeId = uuidv4()
    const newEdge: Edge = {
      id: edgeId,
      source: constraintNodeId,
      target: targetNodeId,
      sourceHandle: null,
      targetHandle: `column-${targetColumn}`,
    }

    // 同上：单条边的添加可直接 push，Vue Flow 会响应式同步
    graphStore.edges.push(newEdge)

    // 延迟聚焦到新节点，确保 Vue Flow 已完成节点渲染和布局计算
    setTimeout(() => {
      fitView({ nodes: [constraintNodeId], padding: 0.25, duration: 300 })
    }, 100)

    toastSuccess(t('aiChat.constraintCreated', { table: tableName, column: targetColumn }))
  }
}

/**
 * 处理内嵌约束指令
 *
 * 将约束直接附加到目标节点的列定义上，不创建独立节点和连线。
 * 约束数据存储在 column.constraints 字典中，键为约束类型小写，值为 { id, enabled }。
 *
 * 副作用：
 * - 修改 graphStore.nodes 中目标节点的列定义
 * - 通过替换节点引用触发 Vue 响应式更新
 *
 * @param targetNode - AI 指定的目标表节点
 * @param constraintType - 约束类型（如 NOT_NULL, UNIQUE 等）
 * @param columnName - 目标列名
 * @param constraintId - 约束唯一标识
 */
async function handleInlineConstraint(
  targetNode: VueFlowNode,
  constraintType: string,
  columnName: string,
  constraintId: string
) {
  const graphStore = useGraphStore()
  const { t } = useI18n()

  // 将节点数据转为通用 Record 以便动态访问 columns 属性
  const nodeData = targetNode.data as unknown as Record<string, unknown>
  if (!nodeData.columns) {
    logger.warn(`[AI Chat] 目标节点没有 columns 数组`)
    return
  }

  // 在 columns 数组中查找目标列
  const column = (nodeData.columns as unknown[]).find(
    (c) => (c as Record<string, unknown>).columnName === columnName
  ) as Record<string, unknown> | undefined
  if (!column) {
    logger.warn(`[AI Chat] 目标节点没有列: ${columnName}`)
    toastError(t('aiChat.columnNotFound', { column: columnName }))
    return
  }

  // 初始化列的 constraints 字典（如果不存在）
  if (column && !column.constraints) {
    column.constraints = {}
  }

  // 写入内嵌约束：键为类型小写，值为约束元数据
  const constraintKey = constraintType.toLowerCase()
  column.constraints[constraintKey] = {
    id: constraintId,
    enabled: true,
  }

  // 通过替换节点引用触发 Vue 响应式更新（直接修改嵌套对象不会触发 watcher）
  const nodeIndex = graphStore.nodes.findIndex((n) => n.id === targetNode.id)
  if (nodeIndex !== -1) {
    graphStore.nodes[nodeIndex] = { ...targetNode }
  }
}
