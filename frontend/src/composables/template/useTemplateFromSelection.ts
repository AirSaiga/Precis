/**
 * @file useTemplateFromSelection.ts
 * @description 从画布选区提取模板定义 - 将选中的节点 DAG 打包为可复用模板
 *
 * 核心职责：
 * - 从选中的画布节点中过滤出 eligible 节点（transform / constraint / regex / manualData）
 * - 将每个节点映射为后端 TemplateNode 格式
 * - 校验模板自包含性（非 manualData 节点的 inputFromNode 必须指向模板内部）
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
  kind: 'transform' | 'constraint' | 'regex' | 'manualData'
  type: string
  input_from_node: string | null
  input_column?: string | null
  params: Record<string, unknown>
  output_columns: string[]
  refs: Record<string, unknown>
  enabled: boolean
  description?: string | null
  // manualData 专用字段
  column_name?: string
  rows?: string[][]
  column_data_type?: string
}

interface ExtractionResult {
  templateNodes: TemplateNode[]
  inputAnchorId: string | null
  eligibleCount: number
  excludedCount: number
  summary: { transforms: number; constraints: number; regexNodes: number; manualData: number }
  warnings: string[]
  /** 结构合法性错误（阻断模板创建） */
  errors: string[]
}

// === 辅助函数 ===

/** 判断节点是否可被打包进模板 */
function isEligibleNode(node: CustomNode): boolean {
  const type = node.type
  if (!type) return false
  return (
    type === 'transform' || type === 'regex' || type === 'manualData' || isConstraintNodeType(type)
  )
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

/** 提取 ManualData 节点 */
function extractManualDataNode(node: CustomNode): TemplateNode {
  const d = (node.data || {}) as Record<string, unknown>
  return {
    id: node.id,
    kind: 'manualData',
    type: 'ManualData',
    input_from_node: (d.inputFromNode as string) || null,
    input_column: null,
    params: {},
    output_columns: [],
    refs: {},
    enabled: d.enabled !== false,
    description: (d.configName as string) || null,
    column_name: (d.columnName as string) || 'Column1',
    rows: (d.rows as string[][]) || [],
    column_data_type: (d.columnDataType as string) || 'string',
  }
}

/**
 * 检测外部引用：非 manualData 节点的 inputFromNode 指向模板外部时，
 * 模板无法自包含，应阻断保存。
 */
function detectExternalReferences(
  eligibleNodes: CustomNode[],
  eligibleIdSet: Set<string>
): string[] {
  const errors: string[] = []
  for (const node of eligibleNodes) {
    if (node.type === 'manualData') continue
    const d = node.data as unknown as Record<string, unknown> | undefined
    const inputFrom = d?.inputFromNode as string | undefined
    if (inputFrom && !eligibleIdSet.has(inputFrom)) {
      errors.push(node.id)
    }
  }
  return errors
}

// === 核心导出 ===

/**
 * 从画布选区中提取模板节点数据
 */
export function extractTemplateFromSelection(nodes: CustomNode[], edges: Edge[]): ExtractionResult {
  const eligibleNodes = nodes.filter(isEligibleNode)
  const eligibleIdSet = new Set(eligibleNodes.map((n) => n.id))
  const excludedCount = nodes.length - eligibleNodes.length

  // 映射为 TemplateNode
  const templateNodes: TemplateNode[] = eligibleNodes.map((node) => {
    if (node.type === 'transform') return extractTransformNode(node)
    if (node.type === 'regex') return extractRegexNode(node)
    if (node.type === 'manualData') return extractManualDataNode(node)
    return extractConstraintNode(node, nodes)
  })

  // 检测外部引用：模板必须自包含
  const externalRefs = detectExternalReferences(eligibleNodes, eligibleIdSet)

  // 统计
  const summary = {
    transforms: templateNodes.filter((n) => n.kind === 'transform').length,
    constraints: templateNodes.filter((n) => n.kind === 'constraint').length,
    regexNodes: templateNodes.filter((n) => n.kind === 'regex').length,
    manualData: templateNodes.filter((n) => n.kind === 'manualData').length,
  }

  // 警告
  const warnings: string[] = []
  if (excludedCount > 0) {
    warnings.push('excludedNodes')
  }

  // 结构合法性校验
  const errors: string[] = []
  const enabledTemplateNodes = templateNodes.filter((n) => n.enabled !== false)
  if (!enabledTemplateNodes.some((n) => n.kind === 'manualData')) {
    errors.push('missingManualData')
  }
  if (!enabledTemplateNodes.some((n) => n.kind === 'constraint')) {
    errors.push('missingConstraint')
  }
  if (externalRefs.length > 0) {
    errors.push('externalInputReference')
  }

  return {
    templateNodes,
    inputAnchorId: null,
    eligibleCount: eligibleNodes.length,
    excludedCount,
    summary,
    warnings,
    errors,
  }
}

/**
 * 构建模板 API payload 并保存
 */
export async function saveTemplateFromSelection(
  meta: { id: string; name: string; description: string },
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
    nodes: templateNodes.map((n) => ({
      ...n,
      input_from_node: n.input_from_node || null,
    })),
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
