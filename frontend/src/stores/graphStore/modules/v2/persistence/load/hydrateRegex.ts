/**
 * @file hydrateRegex.ts
 * @description V2 Regex 节点水合模块
 *
 * 将后端 V2 项目配置中的正则节点定义反序列化为画布上的 Regex 节点。
 *
 * 功能概述：
 * - hydrateRegexNodesFromV2Config: 主入口，遍历 manifest.regex_nodes
 * - 解析正则模式（直接模式或引用模式）
 * - 建立 Regex 节点到 Schema 列的 source_ref 关联
 * - 自动布局：按网格排列（3列，间距 420x240）
 *
 * 架构设计：
 * - 纯函数设计，接收 config + existingNodes 作为参数
 * - 通过 existingNodes 查找源 Schema 节点以建立边
 * - 返回 { nodes, edges } 供上层合并
 */

import type { Edge } from '@vue-flow/core'
import type { CustomNode, RegexNodeData } from '@/types/graph'
import type { FullConfigV2Response, RegexNodeFileV2 } from '@/types/projectV2'
interface ColumnLike {
  id?: string
  columnName?: string
}

export function hydrateRegexNodesFromV2Config(params: {
  config: FullConfigV2Response
  existingNodes: CustomNode[]
}) {
  const { config, existingNodes } = params

  const nextNodes: CustomNode[] = []
  const nextEdges: Edge[] = []

  const regexNodes = config.regex_nodes
  const regexRefs = config.manifest.regex_nodes || []
  regexRefs.forEach((ref, idx) => {
    if (!regexNodes) return
    const rData = regexNodes[ref.id] as RegexNodeFileV2 | undefined

    const nodeId = ref.id
    const pos = { x: 980 + (idx % 3) * 420, y: 80 + Math.floor(idx / 3) * 240 }

    const rRec = rData || ({} as RegexNodeFileV2)
    const v2SourceRef = rRec.source_ref
      ? {
          nodeId: String(rRec.source_ref.table_id),
          v2ColumnId: String(rRec.source_ref.column_id),
        }
      : null
    const v2ColumnName = rRec.source_column_name || ''

    const schemaNode = v2SourceRef
      ? existingNodes.find((n) => n.id === v2SourceRef.nodeId && n.type === 'schema')
      : null
    const schemaColumns = schemaNode
      ? ((schemaNode.data as Record<string, unknown> | undefined)?.columns as
          | ColumnLike[]
          | undefined)
      : undefined

    // 按列名匹配当前 schema 列（与 constraint hydrate 策略一致）
    const resolvedColByName =
      v2ColumnName && schemaColumns
        ? schemaColumns.find((x) => x.columnName === v2ColumnName)
        : undefined
    const actualColumnId = resolvedColByName?.id || v2SourceRef?.v2ColumnId || ''

    const sourceRef = v2SourceRef
      ? { nodeId: v2SourceRef.nodeId, columnId: actualColumnId }
      : undefined

    nextNodes.push({
      id: nodeId,
      type: 'regex',
      position: pos,
      data: {
        configName: rRec.name || 'Regex',
        pattern: rRec.pattern || '',
        description: rRec.description || '',
        parameters: rRec.parameters || [],
        matchMode: rRec.match_mode || 'full',
        enabled: rRec.enabled !== false,
        caseSensitive: !!rRec.case_sensitive,
        flags: rRec.flags || '',
        validationRules: {},
        rules: rRec.rules || [],
        validationStatus: 'idle',
        errorCount: 0,
        totalRows: 0,
        matchCount: 0,
        lastValidationTime: undefined,
        sourceRef,
        saveState: 'saved',
      } as unknown as RegexNodeData,
    })

    if (sourceRef?.nodeId && sourceRef?.columnId) {
      nextEdges.push({
        id: `e-${sourceRef.nodeId}-${nodeId}-${sourceRef.columnId}`,
        source: sourceRef.nodeId,
        target: nodeId,
        sourceHandle: `source-right-${sourceRef.columnId}`,
        targetHandle: 'regex-input',
        type: 'smoothstep',
        animated: true,
        style: { stroke: 'var(--edge-schema-to-regex)', strokeWidth: 2 },
      } as Edge)
    }
  })

  return { nodes: nextNodes, edges: nextEdges }
}
