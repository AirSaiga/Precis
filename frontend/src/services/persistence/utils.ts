/**
 * @fileoverview Persistence 层辅助函数
 *
 * 提供 schema ID 规范化、节点过滤等通用逻辑。
 */

import type { CustomNode, SchemaNodeData, JsonSchemaNodeData } from '@/types/graph'
import { generateSchemaId } from '@/utils/typeHelpers'

/**
 * 构建 canvas UUID -> 确定性 schema ID 的映射
 *
 * 所有 builder 在构造 refs.table_id / source_ref.table_id 时必须使用此映射。
 */
export function buildSchemaIdByNodeId(nodes: CustomNode[]): Record<string, string> {
  const map: Record<string, string> = {}
  for (const n of nodes) {
    if (n.type === 'schema') {
      const data = n.data as SchemaNodeData
      map[n.id] = generateSchemaId(data.sourceFilePath || data.sourceFile || '', data.sheetName)
    } else if (n.type === 'jsonSchema') {
      const data = n.data as JsonSchemaNodeData
      map[n.id] = generateSchemaId(data.sourceFilePath || data.sourceFile || '', undefined)
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
 * 判断节点是否为可持久化节点（排除模板展开预览节点）
 */
export function isPersistentNode(node: CustomNode): boolean {
  return !(node.data as unknown as Record<string, unknown>)?._expandedFromInstanceId
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
