/**
 * @file useTemplateFromSelection.ts
 * @description 从画布选区提取模板定义 - 将选中的节点 DAG 打包为可复用模板
 *
 * 核心职责：
 * - 从选中的画布节点中过滤出 eligible 节点（transform / constraint / regex）
 * - 将每个节点映射为后端 TemplateNode 格式
 * - 检测输入锚点（接收外部输入的入口节点）
 * - 构建 API payload 并调用 createV2Template
 */

import type { Edge, Node } from '@vue-flow/core'
import type { CustomNodeData } from '@/types/nodes'
import {
  isConstraintNodeType,
  getV2ConstraintTypeByNodeType,
} from '@/services/constraints/validationRegistryCore'
import { buildConstraintExportPayload } from '@/services/constraints/constraintExportAdapter'
import { createV2Template } from '@/api/projectV2Api'
import { useResourceTreeStore } from '@/stores/resourceTreeStore'
import { toastSuccess, toastError } from '@/core/toast'
import { useI18n } from 'vue-i18n'

// === 类型定义 ===

type CustomNode = Node<CustomNodeData>

interface TemplateNode {
  id: string
  kind: 'transform' | 'constraint' | 'regex'
  type: string
  input_from_node: string | null
  input_column?: string | null
  params: Record<string, unknown>
  output_columns: string[]
  refs: Record<string, unknown>
  enabled: boolean
  description?: string | null
}

interface TemplateParameter {
  id: string
  type: 'string' | 'integer' | 'decimal' | 'boolean'
  label: string
  required: boolean
  default: unknown
}

interface ExtractionResult {
  templateNodes: TemplateNode[]
  inputAnchorId: string | null
  eligibleCount: number
  excludedCount: number
  summary: { transforms: number; constraints: number; regexNodes: number }
  warnings: string[]
}

// === 辅助函数 ===

/** 判断节点是否可被打包进模板 */
function isEligibleNode(node: CustomNode): boolean {
  const type = node.type
  if (!type) return false
  return type === 'transform' || type === 'regex' || isConstraintNodeType(type)
}

/** 提取 Transform 节点 */
function extractTransformNode(node: CustomNode): TemplateNode {
  const d = (node.data || {}) as Record<string, unknown>
  return {
    id: node.id,
    kind: 'transform',
    type: String(d.transformType || ''),
    input_from_node: (d.inputFromNode as string) || null,
    input_column: (d.inputColumn as string) || null,
    params: (d.params as Record<string, unknown>) || {},
    output_columns: (d.outputColumns as string[]) || [],
    refs: {},
    enabled: d.enabled !== false,
    description: (d.description as string) || null,
  }
}

/** 提取 Constraint 节点 */
function extractConstraintNode(node: CustomNode, allNodes: CustomNode[]): TemplateNode {
  const d = (node.data || {}) as Record<string, unknown>
  const v2Type = getV2ConstraintTypeByNodeType(node.type) || ''

  // 构建 schemaIdByNodeId 映射（从所有可用节点中提取）
  const schemaIdByNodeId: Record<string, string> = {}
  for (const n of allNodes) {
    if (n.type === 'schema' || n.type === 'jsonSchema') {
      const nd = n.data as unknown as Record<string, unknown>
      schemaIdByNodeId[n.id] = String(nd.schemaId || n.id)
    }
  }

  let refs: Record<string, unknown> = {}
  let params: Record<string, unknown> = {}
  try {
    const result = buildConstraintExportPayload({
      nodes: allNodes,
      constraintNodeId: node.id,
      v2Type: v2Type as Parameters<typeof buildConstraintExportPayload>[0]['v2Type'],
      data: d,
      schemaIdByNodeId,
    })
    refs = result.refs
    params = result.params
  } catch {
    // 导出失败时使用空值，不阻塞模板创建
  }

  return {
    id: node.id,
    kind: 'constraint',
    type: v2Type,
    input_from_node: (d.inputFromNode as string) || null,
    input_column: null,
    params,
    output_columns: [],
    refs,
    enabled: d.enabled !== false,
    description: (d.configName as string) || (d.constraintName as string) || null,
  }
}

/** 提取 Regex 节点 */
function extractRegexNode(node: CustomNode): TemplateNode {
  const d = (node.data || {}) as Record<string, unknown>
  return {
    id: node.id,
    kind: 'regex',
    type: 'Regex',
    input_from_node: (d.inputFromNode as string) || null,
    input_column: (d.inputColumn as string) || null,
    params: {
      pattern: d.pattern || '',
      match_mode: d.matchMode || 'full',
      case_sensitive: d.caseSensitive !== false,
      flags: d.flags || '',
    },
    output_columns: (d.outputColumns as string[]) || [],
    refs: {},
    enabled: d.enabled !== false,
    description: (d.description as string) || null,
  }
}

/**
 * 检测输入锚点：找出 inputFromNode 指向选区外部节点的 eligible 节点
 * 这些节点是模板的入口，展开时由 TemplateInstance 的 input_from_node 绑定
 */
function detectInputAnchors(eligibleNodes: CustomNode[], selectedIdSet: Set<string>): string[] {
  const anchors: string[] = []
  for (const node of eligibleNodes) {
    const d = node.data as unknown as Record<string, unknown> | undefined
    const inputFrom = d?.inputFromNode as string | undefined
    // inputFromNode 存在且指向选区外的节点 → 此节点是入口
    if (inputFrom && !selectedIdSet.has(inputFrom)) {
      anchors.push(node.id)
    }
  }
  return anchors
}

// === 核心导出 ===

/**
 * 从画布选区中提取模板节点数据
 */
export function extractTemplateFromSelection(nodes: CustomNode[], edges: Edge[]): ExtractionResult {
  const eligibleNodes = nodes.filter(isEligibleNode)
  const selectedIdSet = new Set(nodes.map((n) => n.id))
  const excludedCount = nodes.length - eligibleNodes.length

  // 映射为 TemplateNode
  const templateNodes: TemplateNode[] = eligibleNodes.map((node) => {
    if (node.type === 'transform') return extractTransformNode(node)
    if (node.type === 'regex') return extractRegexNode(node)
    return extractConstraintNode(node, nodes)
  })

  // 检测输入锚点
  const anchors = detectInputAnchors(eligibleNodes, selectedIdSet)
  const inputAnchorId = anchors.length > 0 ? (anchors[0] ?? null) : null

  // 锚点节点的 input_from_node 设为 null（展开时由实例绑定）
  if (inputAnchorId) {
    const anchorNode = templateNodes.find((n) => n.id === inputAnchorId)
    if (anchorNode) {
      anchorNode.input_from_node = null
    }
  }

  // 统计
  const summary = {
    transforms: templateNodes.filter((n) => n.kind === 'transform').length,
    constraints: templateNodes.filter((n) => n.kind === 'constraint').length,
    regexNodes: templateNodes.filter((n) => n.kind === 'regex').length,
  }

  // 警告
  const warnings: string[] = []
  if (anchors.length > 1) {
    warnings.push('multipleAnchors')
  }
  if (excludedCount > 0) {
    warnings.push('excludedNodes')
  }

  return {
    templateNodes,
    inputAnchorId,
    eligibleCount: eligibleNodes.length,
    excludedCount,
    summary,
    warnings,
  }
}

/**
 * 构建模板 API payload 并保存
 */
export async function saveTemplateFromSelection(
  meta: { id: string; name: string; description: string },
  parameters: TemplateParameter[],
  templateNodes: TemplateNode[],
  configPath?: string
): Promise<boolean> {
  const { t } = useI18n()
  const resourceTreeStore = useResourceTreeStore()

  const payload: Record<string, unknown> = {
    version: 2,
    id: meta.id.trim(),
    name: meta.name.trim(),
    description: meta.description.trim(),
    parameters: parameters.map((p) => ({
      ...p,
      default: p.default === '' ? null : p.default,
    })),
    nodes: templateNodes.map((n) => ({
      ...n,
      input_from_node: n.input_from_node || null,
    })),
    input_anchor: {
      id: 'input_anchor',
      label: '数据源入口',
      accepts: ['schema', 'transformOutput', 'manualData'],
    },
  }

  try {
    await createV2Template(payload, configPath)
    await resourceTreeStore.refreshResources()
    toastSuccess(t('template.saveSuccess', { name: meta.name }))
    return true
  } catch (e) {
    toastError(e instanceof Error ? e.message : t('template.saveFailed'))
    return false
  }
}
