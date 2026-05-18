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

export function hydrateRegexNodesFromV2Config(params: {
  config: any
  existingNodes: CustomNode[]
}) {
  const { config, existingNodes } = params

  const nextNodes: CustomNode[] = []
  const nextEdges: Edge[] = []

  const regexRefs =
    ((config.manifest as unknown as Record<string, unknown>).regex_nodes as
      | Array<{ id: string; path?: string }>
      | undefined) || []
  regexRefs.forEach((ref, idx) => {
    const r = (config as unknown as Record<string, unknown>).regex_nodes as
      | Record<string, Record<string, unknown>>
      | undefined
    const rData = r?.[ref.id]
    if (!r) return
    const nodeId = ref.id as string
    const pos = { x: 980 + (idx % 3) * 420, y: 80 + Math.floor(idx / 3) * 240 }

    const rRec = rData || {}
    const sourceRef = rRec.source_ref
      ? {
          nodeId: String((rRec.source_ref as Record<string, unknown>).table_id),
          columnId: String((rRec.source_ref as Record<string, unknown>).column_id),
        }
      : undefined

    const schemaNode = sourceRef
      ? existingNodes.find((n) => n.id === sourceRef.nodeId && n.type === 'schema')
      : null
    const schemaColumns =
      sourceRef && schemaNode
        ? ((schemaNode.data as unknown as Record<string, unknown> | undefined)?.columns as
            | unknown[]
            | undefined)
        : undefined
    const resolvedCol = schemaColumns?.find((x: any) => x.id === sourceRef?.columnId) as
      | Record<string, unknown>
      | undefined
    const resolvedColumnName = (resolvedCol?.columnName as string) || ''

    nextNodes.push({
      id: nodeId,
      type: 'regex',
      position: pos,
      data: {
        configName: rRec.name || 'Regex',
        pattern: rRec.pattern || '',
        description: rRec.description || '',
        parameters: (rRec.parameters as unknown[] | undefined) || [],
        matchMode: (rRec.match_mode as string | undefined) || 'full',
        enabled: rRec.enabled !== false,
        caseSensitive: !!(rRec.case_sensitive as boolean | undefined),
        flags: (rRec.flags as string | undefined) || '',
        validationRules: {},
        rules: (rRec.rules as unknown[] | undefined) || [],
        validationStatus: 'idle',
        errorCount: 0,
        totalRows: 0,
        matchCount: 0,
        lastValidationTime: undefined,
        sourceRef,
        sourceNodeId: sourceRef?.nodeId,
        sourceColumnName: resolvedColumnName || rRec.source_column_name,
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
