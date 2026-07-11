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
import type { ConstraintKind } from '@/services/constraints/types'
import { getV2RegexNode } from '@/api/projectV2Api'
import { buildNodeData } from '@/services/constraints/nodeDataBuilder'
import { addNodes } from '@/services/canvas/vueFlowApi'

/** 从 Schema 节点中查找列名（按 ID 查找，兼容直接匹配场景） */
function resolveColumnNameById(schemaNode: CustomNode | undefined, columnId: string): string {
  if (!schemaNode) return ''
  return (
    ((schemaNode.data as SchemaNodeData | undefined)?.columns || []).find(
      (x) => (x as { id?: string; columnName?: string }).id === columnId
    )?.columnName || ''
  )
}

/** 按列名在当前 schema 中查找实际列 ID */
function resolveColumnIdByName(
  schemaNode: CustomNode | undefined,
  columnName: string
): string | null {
  if (!schemaNode || !columnName) return null
  const cols = (schemaNode.data as SchemaNodeData | undefined)?.columns || []
  const found = cols.find((x) => (x as { columnName?: string }).columnName === columnName)
  return (found as { id?: string } | undefined)?.id || null
}

export function createV2RegexImporter(params: {
  nodes: Ref<CustomNode[]>
  selectedNodeId: Ref<string | null>
  ensureSchemaNode: (tableId: string, position: { x: number; y: number }) => Promise<CustomNode>
  ensureSchemaToRegexEdge: (tableId: string, regexId: string, columnId: string) => void
  ensureSchemaToRegexExtractEdge: (tableId: string, regexId: string, columnId: string) => void
}) {
  const {
    nodes,
    selectedNodeId,
    ensureSchemaNode,
    ensureSchemaToRegexEdge,
    ensureSchemaToRegexExtractEdge,
  } = params

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
    const v2SourceRef = r.source_ref
      ? { nodeId: String(r.source_ref.table_id), v2ColumnId: String(r.source_ref.column_id) }
      : null
    const v2ColumnName = (r.source_column_name as string) || ''

    const schemaPosition = { x: position.x - 420, y: position.y }
    const schemaNode =
      includeDeps && v2SourceRef?.nodeId
        ? await ensureSchemaNode(v2SourceRef.nodeId, schemaPosition)
        : nodes.value.find((n) => n.id === v2SourceRef?.nodeId)

    // 用列名（与约束节点相同的策略）反查当前 schema 的实际列 ID。
    // V2 配置中的 source_ref.column_id 是 V2 生成的 ID，可能与
    // Ctrl+G 时 TabularColumnGenerator 从 CSV header 生成的列 ID 不同。
    // 而 source_column_name 是实际列名，可与 schema 的 columns 按名称匹配。
    const actualColumnIdFromName = resolveColumnIdByName(schemaNode, v2ColumnName)
    const actualColumnId = actualColumnIdFromName || v2SourceRef?.v2ColumnId || ''

    const resolvedColumnName = v2ColumnName || resolveColumnNameById(schemaNode, actualColumnId)

    const sourceRef = v2SourceRef
      ? { nodeId: v2SourceRef.nodeId, columnId: actualColumnId }
      : undefined

    const isExtract = r.match_mode === 'extract'
    const nodeType = isExtract ? 'regexExtract' : 'regex'

    // 构建 BuildInput — 将 RegexNodeFileV2 的字段打包到 params 中
    const result = buildNodeData(nodeType as unknown as ConstraintKind, {
      mode: 'import',
      configName: r.name || (isExtract ? 'RegexExtract' : 'Regex'),
      schemaNodeId: sourceRef?.nodeId || '',
      tableName: '',
      nodeId: resourceId,
      nodeType,
      columnRef: sourceRef ? { ...sourceRef, columnName: resolvedColumnName } : undefined,
      params: {
        pattern: r.pattern || '',
        description: r.description || '',
        parameters: r.parameters || [],
        match_mode: r.match_mode || 'full',
        enabled: r.enabled,
        case_sensitive: r.case_sensitive,
        flags: r.flags || '',
        rules: r.rules || [],
        capture_groups: r.capture_groups || [],
        output_columns: r.output_columns || [],
        source_column_name: r.source_column_name,
      },
    })

    const regexNode: CustomNode = {
      id: resourceId,
      type: nodeType,
      position,
      data: result.nodeData as unknown as CustomNodeData,
    }
    addNodes(regexNode)
    // addNodes() 只更新 Vue Flow 内部状态，不会同步到 Pinia store 的 nodes ref
    // （v-model 同步在 nextTick 才触发）。手动同步确保本 tick 内的后续节点查找
    // （如后端导入流程完成前的 schemaNode computed）能正确找到该节点。
    nodes.value = [...nodes.value, regexNode]

    // 创建边
    for (const desc of result.edgeDescriptors) {
      if (desc.kind === 'constraint' || desc.kind === 'if') {
        if (isExtract) {
          ensureSchemaToRegexExtractEdge(desc.sourceNodeId, resourceId, desc.columnId)
        } else {
          ensureSchemaToRegexEdge(desc.sourceNodeId, resourceId, desc.columnId)
        }
      }
    }

    selectedNodeId.value = regexNode.id
    return regexNode.id
  }

  return { importRegex }
}
