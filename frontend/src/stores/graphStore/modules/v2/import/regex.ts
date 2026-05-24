/**
 * @file regex.ts
 * @description V2 Regex（正则）节点导入模块
 *
 * 负责将 V2 项目配置中的正则校验节点导入到画布中。
 * 通过 NodeDataBuilder 统一构建节点数据。
 *
 * 核心功能：
 * - importRegex: 根据正则节点 ID 加载并创建 regex 节点
 * - 自动解析 source_ref 引用的表和列，建立 Schema 到 Regex 的边
 * - 支持依赖自动导入和已存在节点的位置更新
 *
 * 数据流：
 * V2 正则配置 → getV2RegexNode API → 解析 BuildInput → buildNodeData → CustomNode(regex) → 画布 + Edge
 */

import type { Ref } from 'vue'
import type { CustomNode, CustomNodeData } from '@/types/graph'
import type { SchemaNodeData } from '@/types/nodes'
import { getV2RegexNode } from '@/api/projectV2Api'
import { buildNodeData } from '@/services/constraints/nodeDataBuilder'

/** 从 Schema 节点中查找列名 */
function resolveColumnName(schemaNode: CustomNode | undefined, columnId: string): string {
  if (!schemaNode) return ''
  return (
    ((schemaNode.data as SchemaNodeData | undefined)?.columns || []).find(
      (x) => (x as { id?: string; columnName?: string }).id === columnId
    )?.columnName || ''
  )
}

export function createV2RegexImporter(params: {
  nodes: Ref<CustomNode[]>
  selectedNodeId: Ref<string | null>
  ensureSchemaNode: (tableId: string, position: { x: number; y: number }) => Promise<CustomNode>
  ensureSchemaToRegexEdge: (tableId: string, regexId: string, columnId: string) => void
}) {
  const { nodes, selectedNodeId, ensureSchemaNode, ensureSchemaToRegexEdge } = params

  async function importRegex(
    resourceId: string,
    position: { x: number; y: number },
    options?: { includeDeps?: boolean; moveIfExists?: boolean }
  ): Promise<string> {
    const includeDeps = options?.includeDeps !== false
    const moveIfExists = options?.moveIfExists === true

    const existingNode = nodes.value.find((n) => n.id === resourceId)
    if (existingNode) {
      if (moveIfExists) {
        existingNode.position = { ...position }
      }
      selectedNodeId.value = resourceId
      return resourceId
    }

    const r = await getV2RegexNode(resourceId)
    const sourceRef = r.source_ref
      ? { nodeId: String(r.source_ref.table_id), columnId: String(r.source_ref.column_id) }
      : undefined

    const schemaPosition = { x: position.x - 420, y: position.y }
    const schemaNode =
      includeDeps && sourceRef?.nodeId
        ? await ensureSchemaNode(sourceRef.nodeId, schemaPosition)
        : nodes.value.find((n) => n.id === sourceRef?.nodeId)

    const resolvedColumnName = resolveColumnName(schemaNode, sourceRef?.columnId || '')

    // 构建 BuildInput — 将 RegexNodeFileV2 的字段打包到 params 中
    const result = buildNodeData('regex' as any, {
      mode: 'import',
      configName: r.name || 'Regex',
      schemaNodeId: sourceRef?.nodeId || '',
      tableName: '',
      nodeId: resourceId,
      nodeType: 'regex',
      columnRef: sourceRef
        ? { ...sourceRef, columnName: resolvedColumnName }
        : undefined,
      params: {
        pattern: r.pattern || '',
        description: r.description || '',
        parameters: r.parameters || [],
        match_mode: r.match_mode || 'full',
        enabled: r.enabled,
        case_sensitive: r.case_sensitive,
        flags: r.flags || '',
        rules: r.rules || [],
        source_column_name: r.source_column_name,
      },
    })

    const regexNode: CustomNode = {
      id: resourceId,
      type: 'regex',
      position,
      data: result.nodeData as unknown as CustomNodeData,
    }
    nodes.value.push(regexNode)

    // 创建边
    for (const desc of result.edgeDescriptors) {
      if (desc.kind === 'constraint' || desc.kind === 'if') {
        ensureSchemaToRegexEdge(desc.sourceNodeId, resourceId, desc.columnId)
      }
    }

    selectedNodeId.value = regexNode.id
    return regexNode.id
  }

  return { importRegex }
}
