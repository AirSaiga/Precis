/*
 * SPDX-License-Identifier: Apache-2.0
 *
 * Copyright 2026 Precis Team
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/**
 * @fileoverview 模板展开的纯规划与节点数据构建（templateExpand 工厂的无状态阶段）：
 * API 结果解析为 ExpandItem、DAG 规划（含 transformOutput/manualData 合成节点与边）、
 * DagNode → CustomNode 的 type+data 构建。不触碰画布与 store 状态，
 * 画布相关的物化/布局/折叠仍留在 templateExpand.ts 工厂闭包内。
 */

import type { CustomNode } from '@/types/graph'
import type { TemplateExpandResult } from '@/api/projectV2Api'
import {
  getConstraintKindByV2Type,
  getConstraintMetaByKind,
} from '@/services/constraints/validationRegistry'

/** API 返回的单个展开节点（解析后的中间表示） */
export interface ExpandItem {
  id: string
  kind: 'transform' | 'constraint' | 'regex' | 'manualData'
  type: string
  inputFromNode: string | null
  data: Record<string, unknown>
}

/** DAG 规划节点（含真实节点和合成节点） */
export interface DagNode {
  id: string
  /** real = API 返回的后端节点; synthetic = 前端自动生成的 UI 节点 */
  origin: 'real' | 'synthetic'
  kind: 'transform' | 'constraint' | 'regex' | 'transformOutput' | 'manualData'
  /** real 节点的原始 API 数据 */
  item?: ExpandItem
  /** 合成节点的附加数据 */
  syntheticData?: Record<string, unknown>
  /** 是否为画布上已存在的节点（复用时不重新创建） */
  existsOnCanvas?: boolean
  /** Stage 3 填充的布局位置 */
  position?: { x: number; y: number }
}

/** DAG 规划边 */
export interface DagEdge {
  sourceId: string
  targetId: string
  sourceHandle?: string
  targetHandle?: string
}

// ============================================================================
// Stage 1: 解析 API 结果
// ============================================================================

export function collectExpandItems(result: TemplateExpandResult): ExpandItem[] {
  const items: ExpandItem[] = []

  for (const t of result.transforms) {
    items.push({
      id: t.id as string,
      kind: 'transform',
      type: t.type as string,
      inputFromNode: (t.input_from_node as string) || null,
      data: t,
    })
  }
  for (const c of result.constraints) {
    items.push({
      id: c.id as string,
      kind: 'constraint',
      type: c.type as string,
      inputFromNode: (c.input_from_node as string) || null,
      data: c,
    })
  }
  for (const r of result.regex_nodes) {
    items.push({
      id: r.id as string,
      kind: 'regex',
      type: 'regex',
      inputFromNode: (r.input_from_node as string) || null,
      data: r,
    })
  }
  for (const md of result.manual_data) {
    items.push({
      id: md.id as string,
      kind: 'manualData',
      type: 'ManualData',
      inputFromNode: (md.input_from_node as string) || null,
      data: md,
    })
  }

  return items
}

// ============================================================================
// Stage 2: 构建 DAG 规划
// ============================================================================

/**
 * 将 ExpandItem[] 转换为完整的 DAG 规划：
 * 1. 真实节点 → DagNode
 * 2. 扫描 transform → constraint 连接，插入 transformOutput 合成节点
 * 3. 无外部输入时，插入 manualData 合成节点
 * 4. 生成完整的 DagEdge 列表
 *
 * @param items collectExpandItems 的解析结果
 * @param existingNodes 画布当前节点（用于 transformOutput 复用检测，按列名匹配）
 */
export function buildDagPlan(
  items: ExpandItem[],
  existingNodes: CustomNode[]
): { dagNodes: DagNode[]; dagEdges: DagEdge[] } {
  const dagNodes: DagNode[] = []
  const dagEdges: DagEdge[] = []
  const itemIdSet = new Set(items.map((i) => i.id))
  const itemMap = new Map(items.map((i) => [i.id, i]))

  // ---- 2a: 将所有 ExpandItem 转为 DagNode ----
  for (const item of items) {
    dagNodes.push({ id: item.id, origin: 'real', kind: item.kind, item })
  }

  // ---- 2b: 检测需要 transformOutput 的 transform 节点 ----
  // 规则：constraint 的 source 是 transform 时，中间需要 transformOutput
  const transformsNeedingOutput = new Set<string>()
  const transformOutputMap = new Map<string, string[]>() // transformId → 每列的 outputNodeId[]

  for (const item of items) {
    if (item.kind !== 'constraint' || !item.inputFromNode) continue
    if (!itemIdSet.has(item.inputFromNode)) continue // 外部节点跳过

    const sourceItem = itemMap.get(item.inputFromNode)
    if (sourceItem?.kind === 'transform') {
      transformsNeedingOutput.add(item.inputFromNode)
    }
  }

  // ---- 2c: 创建 transformOutput 合成节点（每列一个）----
  // 多列 transform（StringSplit/RegexExtract）会产出 N 列，需为每列创建独立 output 节点，
  // 否则只有首列数据能被后续约束消费，其余列被静默丢弃。
  for (const transformId of transformsNeedingOutput) {
    const transformItem = itemMap.get(transformId)!
    const outputColumns = (transformItem.data.output_columns as string[]) || []
    // 列名列表（空数组时退化为单节点，保持向后兼容）
    const colNames = outputColumns.length > 0 ? outputColumns : ['output']

    // 检查画布上是否已有该 transform 的 output 节点（复用场景，按列名匹配）
    const existingOutputs = existingNodes.filter(
      (n) =>
        n.type === 'transformOutput' &&
        (n.data as unknown as Record<string, unknown>)?.parentTransformId === transformId
    )
    const existingByColName = new Map(
      existingOutputs.map((n) => [
        (n.data as unknown as Record<string, unknown>)?.columnName as string | undefined,
        n,
      ])
    )

    const outputNodeIds: string[] = []
    colNames.forEach((colName, i) => {
      const existing = existingByColName.get(colName)
      const outputNodeId = existing?.id || `output-${transformId}-${i}`

      dagNodes.push({
        id: outputNodeId,
        origin: 'synthetic',
        kind: 'transformOutput',
        existsOnCanvas: !!existing,
        syntheticData: {
          parentTransformId: transformId,
          columnName: colName,
          outputColumnIndex: i,
        },
      })

      outputNodeIds.push(outputNodeId)

      // transform → transformOutput 边（每列一条）
      dagEdges.push({
        sourceId: transformId,
        targetId: outputNodeId,
        sourceHandle: 'transform-output',
        targetHandle: 'target-left',
      })
    })

    transformOutputMap.set(transformId, outputNodeIds)
  }

  // ---- 2d: 实例自包含，无外部数据源 ----
  // manualData 节点是模板自带的输入起点，不需要外部数据源。
  // 只有非 manualData 的根节点需要数据源，但实例自包含后不再有外部输入。

  // ---- 2e: 为每个节点生成边 ----
  for (const item of items) {
    // manualData 是 DAG 起点，不需要入边
    if (item.kind === 'manualData') continue

    // 解析源节点 ID
    let sourceId: string | undefined

    if (item.inputFromNode) {
      if (itemIdSet.has(item.inputFromNode)) {
        // 源是展开图中的节点
        sourceId = item.inputFromNode
      } else {
        // 源是外部节点（保留向后兼容，但实例自包含后通常不会出现）
        sourceId = undefined
      }
    } else {
      // 根节点（无 inputFromNode），实例自包含后无外部数据源
      sourceId = undefined
    }

    if (!sourceId) continue

    // 确定目标 handle
    const targetHandle = resolveTargetHandle(item)

    // 如果源是 transform 且目标是 constraint，路由经过 transformOutput
    const sourceItem = itemMap.get(sourceId)
    if (sourceItem?.kind === 'transform' && item.kind === 'constraint') {
      const outputNodeIds = transformOutputMap.get(sourceId) || []
      if (outputNodeIds.length > 0) {
        // 多列 transform：按约束声明的 input_column 路由到对应列的 output 节点。
        // 未声明或不匹配时回退到首列（保持向后兼容）。
        const outputColumns = (sourceItem.data.output_columns as string[]) || []
        const inputColumn = (item.data.input_column as string) || ''
        const colIndex = inputColumn ? outputColumns.indexOf(inputColumn) : 0
        const targetOutputId = outputNodeIds[colIndex >= 0 ? colIndex : 0]
        if (targetOutputId) {
          dagEdges.push({
            sourceId: targetOutputId,
            targetId: item.id,
            targetHandle,
          })
          continue
        }
      }
    }

    // 普通边
    dagEdges.push({
      sourceId,
      targetId: item.id,
      targetHandle,
    })
  }

  return { dagNodes, dagEdges }
}

/** 根据节点 kind 确定目标 handle */
function resolveTargetHandle(item: ExpandItem): string | undefined {
  switch (item.kind) {
    case 'transform':
      return 'transform-input'
    case 'regex':
      return 'regex-input'
    case 'constraint':
      return `target-input-${item.id}`
    default:
      return undefined
  }
}

// ============================================================================
// Node data builders（Stage 4 的数据准备，纯函数）
// ============================================================================

/** 根据 DagNode 构建 CustomNode 的 type + data */
export function buildCustomNode(
  dagNode: DagNode,
  instanceNodeId: string
): { type: string; data: Record<string, unknown> } | null {
  switch (dagNode.kind) {
    case 'transform':
      return buildTransformData(dagNode.item!, instanceNodeId)
    case 'constraint':
      return buildConstraintNodeData(dagNode.item!, instanceNodeId)
    case 'regex':
      return buildRegexData(dagNode.item!, instanceNodeId)
    case 'transformOutput':
      return buildTransformOutputData(dagNode)
    case 'manualData':
      return buildManualDataData(dagNode)
    default:
      return null
  }
}

function buildTransformData(
  item: ExpandItem,
  instanceNodeId: string
): { type: string; data: Record<string, unknown> } {
  return {
    type: 'transform',
    data: {
      configName: (item.data.description as string) || item.id,
      transformType: item.type,
      description: item.data.description,
      inputColumn: item.data.input_column || undefined,
      params: (item.data.params || {}) as Record<string, unknown>,
      outputColumns: item.data.output_columns || [],
      enabled: true,
      saveState: 'draft',
      _expandedFromInstanceId: instanceNodeId,
    },
  }
}

function buildConstraintNodeData(
  item: ExpandItem,
  instanceNodeId: string
): { type: string; data: Record<string, unknown> } | null {
  const kind = getConstraintKindByV2Type(item.type)
  if (!kind) return null
  const meta = getConstraintMetaByKind(kind)
  if (!meta) return null

  const refs = (item.data.refs || {}) as Record<string, unknown>
  const params = (item.data.params || {}) as Record<string, unknown>

  const tableId = refs.table_id || refs.tableId || ''
  const columnId = refs.column_id || refs.columnId || ''
  const columnIds = refs.column_ids || refs.columnIds
  const inputColumn = (item.data.input_column as string) || ''

  // 兼容仅通过 input_column 指定目标列的模板
  const effectiveColumnId = columnId || inputColumn
  const effectiveColumnIds = Array.isArray(columnIds) ? columnIds : []

  const base: Record<string, unknown> = {
    configName: (item.data.description as string) || item.id,
    constraintName: item.id,
    saveState: 'draft',
    _expandedFromInstanceId: instanceNodeId,
    table: tableId,
    // inputColumn 用于 inline 数据源场景（manualData / transformOutput），
    // 明确告诉行内校验应该以哪一列作为目标列。
    inputColumn: effectiveColumnId || effectiveColumnIds[0] || undefined,
  }

  // 写入 sourceRef，使单约束校验和重验能定位到源节点/列
  if (tableId && (effectiveColumnId || effectiveColumnIds.length > 0)) {
    base.sourceRef = {
      nodeId: tableId,
      columnId: effectiveColumnId || effectiveColumnIds[0],
    }
  }

  switch (kind) {
    case 'notNull':
      base.column = effectiveColumnId
      break

    case 'unique':
      base.column = effectiveColumnIds.length > 0 ? effectiveColumnIds : effectiveColumnId
      break

    case 'allowedValues':
      base.column = effectiveColumnId
      base.allowedValues = params.allowed_values || []
      break

    case 'foreignKey':
      base.sourceTable = refs.from_table_id || ''
      base.sourceColumn = refs.from_column_id || ''
      base.targetTable = refs.to_table_id || ''
      base.targetColumn = refs.to_column_id || ''
      if (base.sourceTable && base.sourceColumn) {
        base.sourceRef = {
          nodeId: base.sourceTable as string,
          columnId: base.sourceColumn as string,
        }
      }
      break

    case 'range':
      base.column = effectiveColumnId
      base.minValue = params.min ?? 0
      base.maxValue = params.max ?? 100
      base.boundaryMode = params.boundary_mode || 'inclusive'
      break

    case 'conditional':
      base.ifColumn = refs.if_column_id || ''
      base.ifValue = ''
      base.ifConditions = params.if_conditions || []
      base.ifLogic = refs.if_logic || 'and'
      base.thenColumn = refs.then_column_id || ''
      break

    case 'scripted':
      base.column = effectiveColumnId
      base.expression = params.expression || ''
      break

    case 'charset':
      base.column = effectiveColumnId
      base.charsetMode = params.charset_mode || 'ascii'
      break

    case 'dateLogic':
      base.column = effectiveColumnId
      base.logicMode = params.logic_mode || 'compare'
      break

    case 'composite':
      base.subGraph = { nodes: [], edges: [] }
      break
  }

  return { type: meta.nodeType, data: base }
}

function buildRegexData(
  item: ExpandItem,
  instanceNodeId: string
): { type: string; data: Record<string, unknown> } {
  return {
    type: 'regex',
    data: {
      configName: (item.data.name as string) || item.id,
      name: (item.data.name as string) || item.id,
      pattern: item.data.pattern || '',
      description: item.data.description || '',
      matchMode: item.data.match_mode || 'full',
      caseSensitive: item.data.case_sensitive !== false,
      enabled: true,
      saveState: 'draft',
      parameters: item.data.parameters || undefined,
      _expandedFromInstanceId: instanceNodeId,
    },
  }
}

function buildTransformOutputData(dagNode: DagNode): {
  type: string
  data: Record<string, unknown>
} {
  const sd = dagNode.syntheticData || {}
  return {
    type: 'transformOutput',
    data: {
      configName: (sd.columnName as string) || 'output',
      columnName: (sd.columnName as string) || 'output',
      rows: [],
      parentTransformId: sd.parentTransformId || '',
      saveState: 'draft',
    },
  }
}

function buildManualDataData(dagNode: DagNode): { type: string; data: Record<string, unknown> } {
  // real origin: 从模板展开结果中读取数据
  if (dagNode.item) {
    const d = dagNode.item.data
    return {
      type: 'manualData',
      data: {
        configName: (d.column_name as string) || 'Column1',
        columnName: (d.column_name as string) || 'Column1',
        columnDataType: (d.column_data_type as string) || 'string',
        rows: (d.rows as string[][]) || [],
        saveState: 'draft',
        _expandedFromInstanceId: undefined,
      },
    }
  }
  // synthetic origin（向后兼容）
  const sd = dagNode.syntheticData || {}
  return {
    type: 'manualData',
    data: {
      configName: (sd.configName as string) || 'Manual Input',
      columnName: (sd.columnName as string) || 'Column1',
      rows: (sd.rows as string[][]) || [['value1'], ['value2'], ['value3']],
      saveState: 'draft',
    },
  }
}
