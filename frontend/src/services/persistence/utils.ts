/**
 * @fileoverview Persistence 层辅助函数
 *
 * 提供 schema ID 规范化、节点过滤等通用逻辑。
 *
 * 语义化 ID 方案：画布节点 ID 直接作为 schema ID，无需映射。
 */

import type { CustomNode } from '@/types/graph'

/**
 * 构建 canvas node ID -> schema ID 的映射
 *
 * 语义化 ID 方案下，schema 节点的 ID 就是 schema ID，映射为恒等映射。
 * 保留此函数以维持 builder 接口兼容。
 */
export function buildSchemaIdByNodeId(nodes: CustomNode[]): Record<string, string> {
  const map: Record<string, string> = {}
  for (const n of nodes) {
    if (n.type === 'schema' || n.type === 'jsonSchema') {
      map[n.id] = n.id
    }
  }
  return map
}

/**
 * 规范化 table_id：将 canvas UUID 转换为确定性 schema ID
 */
export function normalizeTableId(
  rawNodeId: string | undefined,
  schemaIdByNodeId: Record<string, string>
): string | undefined {
  if (!rawNodeId) return undefined
  return schemaIdByNodeId[rawNodeId] || rawNodeId
}

/**
 * 宽松读取节点 data 为 Record（CustomNodeData 是 discriminated union，
 * 读取跨类型松散字段需经 unknown 中转——本模块唯一的边界断言）。
 * 导出供持久化相关的跨类型读取复用，避免散落新的双重断言。
 */
export function looseData(node: CustomNode): Record<string, unknown> {
  return (node.data ?? {}) as unknown as Record<string, unknown>
}

/**
 * 判断节点是否为可持久化节点（排除模板展开预览节点与未完成的草稿节点）
 */
export function isPersistentNode(node: CustomNode): boolean {
  const data = looseData(node)
  if (data._expandedFromInstanceId) return false
  return !isIncompleteDraftNode(node)
}

/** 约束工厂的表引用占位值（连线时会回写真实表名，见 useConstraintConnection） */
const PLACEHOLDER_TABLE_VALUES = new Set(['table_name', 'source_table'])

/**
 * 判断节点是否为"未完成的草稿"（D-1 方案 B：跳过持久化而非阻断整项目保存）。
 *
 * 仅覆盖会产生保存 BLOCKER 的两类节点，配置完成后自然恢复持久化：
 * - schema/jsonSchema：saveState=draft 且无任何数据源（与 buildSourceSpec 的 undefined 条件一致），
 *   配置数据源后即不再命中
 * - 约束节点：saveState=draft 且表引用仍为工厂占位值（未连线），
 *   连线时 useConstraintConnection 会回写真实 table + sourceRef，即不再命中
 *
 * 其他类型（manualData/transform/regex/templateInstance 等）不产生 BLOCKER，不跳过。
 */
export function isIncompleteDraftNode(node: CustomNode): boolean {
  const data = looseData(node)
  if (data.saveState !== 'draft') return false
  const t = node.type
  if (t === 'schema' || t === 'jsonSchema') {
    return !data.sourceFilePath && !data.sourceFile && !data.localPath
  }
  if (typeof t === 'string' && t.endsWith('Constraint')) {
    const table = data.table ?? data.sourceTable
    return !table || (typeof table === 'string' && PLACEHOLDER_TABLE_VALUES.has(table))
  }
  return false
}

/**
 * 过滤出需要持久化的节点
 */
export function filterPersistentNodes(nodes: CustomNode[]): CustomNode[] {
  return nodes.filter(isPersistentNode)
}

import { findBuilderFor } from './builders/registry'

/**
 * 使用注册的 builder 构建单个节点的 V2 文件对象
 *
 * @param node - 目标节点
 * @param allNodes - 画布中所有节点（用于引用解析）
 * @param configPath - 项目配置路径
 * @returns 构建的文件对象，如果无匹配 builder 则返回 undefined
 */
export function buildNodeFile(
  node: CustomNode,
  allNodes: CustomNode[],
  configPath: string
): unknown | undefined {
  const builder = findBuilderFor(node)
  if (!builder) return undefined

  const schemaIdByNodeId = buildSchemaIdByNodeId(allNodes)
  const { file } = builder.build({
    nodes: allNodes,
    node,
    schemaIdByNodeId,
    configPath,
  })
  return file
}
