/**
 * @file regex.ts
 * @description V2 Regex（正则）节点导入模块
 *
 * 负责将 V2 项目配置中的正则校验节点导入到画布中。
 * 包括正则表达式模式、匹配规则、参数配置以及源表列引用关系。
 *
 * 核心功能：
 * - importRegex: 根据正则节点 ID 加载并创建 regex 节点
 * - 自动解析 source_ref 引用的表和列，建立 Schema 到 Regex 的边
 * - 支持依赖自动导入和已存在节点的位置更新
 *
 * 数据流：
 * V2 正则配置 → getV2RegexNode API → Regex 数据 → CustomNode(regex) → 画布 + Edge
 */

import type { Ref } from 'vue'
import type { CustomNode, RegexNodeData } from '@/types/graph'
import type { RegexParameter, Rule } from '@/features/regex/types'
import { getV2RegexNode } from '@/api/projectV2Api'

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

    const resolvedColumnName =
      sourceRef && schemaNode
        ? (() => {
            const cols = (schemaNode.data as unknown as Record<string, unknown>).columns as
              | unknown[]
              | undefined
            const found = cols?.find(
              (x) => (x as Record<string, unknown>).id === sourceRef.columnId
            )
            return found ? String((found as Record<string, unknown>).columnName || '') : ''
          })()
        : ''

    const regexNode: CustomNode = {
      id: resourceId,
      type: 'regex',
      position,
      data: {
        configName: r.name || 'Regex',
        pattern: r.pattern || '',
        description: r.description || '',
        parameters: (r.parameters || []) as unknown as RegexParameter[],
        matchMode: r.match_mode || 'full',
        enabled: r.enabled !== false,
        caseSensitive: !!r.case_sensitive,
        flags: r.flags || '',
        validationRules: {},
        rules: (r.rules || []) as unknown as Rule[],
        validationStatus: 'idle',
        errorCount: 0,
        totalRows: 0,
        matchCount: 0,
        lastValidationTime: undefined,
        sourceRef,
        sourceNodeId: sourceRef?.nodeId,
        sourceColumnName: resolvedColumnName || r.source_column_name,
        saveState: 'saved',
      } as unknown as RegexNodeData,
    }
    nodes.value.push(regexNode)

    if (sourceRef?.nodeId && sourceRef?.columnId) {
      ensureSchemaToRegexEdge(sourceRef.nodeId, resourceId, sourceRef.columnId)
    }

    selectedNodeId.value = regexNode.id
    return regexNode.id
  }

  return { importRegex }
}
