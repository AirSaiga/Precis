/**
 * @file serializeCanvasForAI.ts
 * @description 画布节点 → AI 请求体快照的序列化（纯逻辑，无框架依赖，可单测）
 *
 * 职责：把 graphStore.nodes 裁剪为体积可控、语义清晰的摘要，供后端 read_canvas 工具查询。
 *
 * 设计原则（针对 token 体积与信噪比）：
 * - 过滤结构性节点（projectRoot / 各类 Set 容器）——它们对 LLM 判断"画布上有什么"无意义。
 * - 字段裁剪：每节点只保留标识与语义字段（tableName / configName / column / pattern 等），
 *   丢弃 rows（ManualData 可能上万行）、validationErrors、saveState、Vue Flow 内部键。
 * - schema 类节点的 columns 只保留 id / columnName / dataType，去掉约束/绑定/校验详情
 *   （约束关系由独立约束节点表达，避免冗余）。
 */

import type { CustomNode } from '@/types/nodes'
import { isConstraintNodeType } from '@/services/constraints/validationRegistryCore'

/**
 * 后端 read_canvas 接收的单节点形状（与 AiChatContextNode 对齐）
 */
export interface CanvasNodeSnapshot {
  id: string
  type: string
  data: Record<string, unknown>
  label?: string
}

/**
 * 需要从节点 data 中丢弃的重型/无关键集合（黑名单）。
 * 这些字段体积大或对 LLM 判断画布内容无价值。
 */
const DATA_DROP_KEYS = new Set<string>([
  'rows', // ManualData/TransformOutput 二维数组，可能上万行
  'validationErrors',
  'validationStatus',
  'lastValidation',
  'sourceRef',
  'saveState',
  'sourceNodeId',
  // Vue Flow 内部 / 节点关系键（由 edges 表达，不必冗余进节点）
  'children',
  'parentNode',
  'extent',
  'width',
  'height',
  'dragging',
  'selected',
  // 时间戳
  'createdAt',
  'updatedAt',
])

/**
 * schema 类节点 columns 中每列只保留的键
 */
const COLUMN_KEEP_KEYS = new Set<string>(['id', 'columnName', 'dataType', 'name'])

/**
 * 判断节点是否为应排除的结构性容器/根节点。
 *
 * projectRoot、各类 Set/Root 节点不承载业务语义，对"画布上有哪些表/约束"的判断无价值。
 */
function isStructuralNode(nodeType: string | undefined): boolean {
  if (!nodeType) return true
  if (nodeType === 'projectRoot') return true
  // 各类集合容器：TableSetNode / TableSetRootNode / SchemaSetNode / SchemaSetRootNode /
  // ConstraintRuleSetNode / ConstraintRuleSetRootNode / RegexSetNode / RegexSetRootNode
  return nodeType.endsWith('SetNode') || nodeType.endsWith('SetRootNode')
}

/**
 * 提取节点的人类可读标签（与 useCanvasContextMenu.extractNodeLabel 同逻辑）
 */
function extractLabel(nodeType: string, data: Record<string, unknown>): string {
  if (nodeType === 'schema' || nodeType === 'jsonSchema') {
    return (data.tableName as string) || (data.configName as string) || (data.name as string) || ''
  }
  if (isConstraintNodeType(nodeType)) {
    return (data.configName as string) || (data.constraintName as string) || ''
  }
  return (data.configName as string) || (data.name as string) || (data.label as string) || ''
}

/**
 * 裁剪 schema/jsonSchema 节点的 columns 数组：每列只保留 id/columnName/dataType。
 */
function slimColumns(columns: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(columns)) return []
  return columns
    .map((col) => {
      if (typeof col !== 'object' || col === null) return null
      const c = col as Record<string, unknown>
      const slim: Record<string, unknown> = {}
      for (const key of Object.keys(c)) {
        if (COLUMN_KEEP_KEYS.has(key)) {
          slim[key] = c[key]
        }
      }
      return slim
    })
    .filter((c): c is Record<string, unknown> => c !== null)
}

/**
 * 裁剪单个节点的 data，去掉重型/无关字段，schema 类节点额外精简 columns。
 */
function slimNodeData(nodeType: string, rawData: unknown): Record<string, unknown> {
  if (typeof rawData !== 'object' || rawData === null) return {}
  const src = rawData as Record<string, unknown>
  const slim: Record<string, unknown> = {}

  for (const key of Object.keys(src)) {
    if (DATA_DROP_KEYS.has(key)) continue
    // schema/jsonSchema 节点的 columns 做列级裁剪
    if ((nodeType === 'schema' || nodeType === 'jsonSchema') && key === 'columns') {
      const slimmed = slimColumns(src[key])
      if (slimmed.length > 0) slim[key] = slimmed
      continue
    }
    // 仅保留可序列化的原始值（跳过函数/symbol，防 JSON 序列化异常）
    const val = src[key]
    if (typeof val === 'function' || typeof val === 'symbol') continue
    slim[key] = val
  }

  return slim
}

/**
 * 把 graphStore 全量画布节点序列化为后端 read_canvas 可消费的摘要快照。
 *
 * @param nodes graphStore.nodes（Vue Flow CustomNode[]）
 * @returns 裁剪后的节点摘要数组（已过滤结构性节点）
 */
export function serializeCanvasForAI(nodes: CustomNode[]): CanvasNodeSnapshot[] {
  const result: CanvasNodeSnapshot[] = []

  for (const node of nodes) {
    const nodeType = node.type || ''
    // 过滤结构性节点（projectRoot / Set 容器）
    if (isStructuralNode(node.type)) continue

    const rawData = (node.data ?? {}) as Record<string, unknown>
    const slimmedData = slimNodeData(nodeType, rawData)
    const label = extractLabel(nodeType, rawData)

    const snapshot: CanvasNodeSnapshot = {
      id: node.id,
      type: nodeType,
      data: slimmedData,
    }
    if (label) snapshot.label = label

    result.push(snapshot)
  }

  return result
}
