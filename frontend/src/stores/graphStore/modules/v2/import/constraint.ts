/**
 * @file constraint.ts
 * @description V2 Constraint（约束）导入模块
 *
 * 负责将 V2 项目配置中的独立约束文件导入为画布约束节点。
 * 通过 NodeDataBuilder 统一构建节点数据，消除各约束类型的重复数据构建代码。
 *
 * 核心功能：
 * - importConstraint: 根据约束 ID 加载并创建约束节点
 * - 自动解析约束引用的表和列，建立节点间的边关系
 * - 支持依赖自动导入（includeDeps）和位置更新（moveIfExists）
 *
 * 数据流：
 * V2 约束配置 → getV2Constraint API → 解析 BuildInput → buildNodeData → CustomNode → 画布 + Edge
 */

import type { Ref } from 'vue'
import type { Edge } from '@vue-flow/core'
import type { CustomNode, CustomNodeData } from '@/types/graph'
import type { SchemaNodeData } from '@/types/nodes'
import type { TableSchemaFileV2 } from '@/types/projectV2'
import {
  getConstraintKindByV2Type,
  getConstraintNodeTypeByV2Type,
} from '@/services/constraints/validationRegistry'
import type { ConstraintKind } from '@/services/constraints/types'
import type { BuildInput, EdgeDescriptor } from '@/services/constraints/nodeDataBuilder'
import { getV2Constraint } from '@/api/projectV2Api'
import { buildNodeData } from '@/services/constraints/nodeDataBuilder'
import { logger } from '@/core/utils/logger'
import { addNodes } from '@/services/canvas/vueFlowApi'

/** 从 Schema 节点中查找列名 */
function resolveColumnName(schemaNode: CustomNode | undefined, columnId: string): string {
  if (!schemaNode) return ''
  return (
    ((schemaNode.data as SchemaNodeData | undefined)?.columns || []).find(
      (x) => (x as { id?: string; columnName?: string }).id === columnId
    )?.columnName || ''
  )
}

/** 获取 Schema 的 tableName */
function resolveTableName(schemaNode: CustomNode | undefined): string {
  return (schemaNode?.data as SchemaNodeData | undefined)?.tableName || ''
}

export function createV2ConstraintImporter(params: {
  nodes: Ref<CustomNode[]>
  edges: Ref<Edge[]>
  selectedNodeId: Ref<string | null>
  /**
   * ensureSchemaNode 的类型签名（与 schema.ts 中定义一致）。
   * constraint.ts 仅使用 tableId/position/options 参数，从不传 schemaFile，
   * 但保留完整签名以确保与 ensureSchemaNode 的真实类型兼容。
   */
  ensureSchemaNode: (
    tableId: string,
    position: { x: number; y: number },
    schemaFile?: TableSchemaFileV2,
    options?: { importRelatedConstraints?: boolean; excludeConstraintId?: string }
  ) => Promise<CustomNode>
  ensureSchemaToConstraintEdge: (tableId: string, constraintId: string, columnId: string) => void
  bufferEdge: (edge: Edge) => void
}) {
  const {
    nodes,
    edges,
    selectedNodeId,
    ensureSchemaNode,
    ensureSchemaToConstraintEdge,
    bufferEdge,
  } = params

  async function importConstraint(
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

    const c = await getV2Constraint(resourceId)
    const kind = getConstraintKindByV2Type(c.type)
    if (!kind) {
      logger.warn(`[constraint.ts] 未知约束类型 "${c.type}"，跳过导入 (resourceId=${resourceId})`)
      return ''
    }
    const nodeType = getConstraintNodeTypeByV2Type(c.type) ?? 'constraint'
    const refs = c.refs as Record<string, unknown>
    const cParams = c.params as Record<string, unknown> | undefined

    // ========================================================================
    // 解析 Schema 节点和列名 — 根据约束类型不同有不同的引用结构
    // ========================================================================

    let buildInput: BuildInput

    if (c.type === 'ForeignKey') {
      // FK 有两个 Schema 引用
      const fromTableId = refs.from_table_id as string
      const fromColId = refs.from_column_id as string
      const toTableId = refs.to_table_id as string
      const toColId = refs.to_column_id as string

      const fromSchema = includeDeps
        ? await ensureSchemaNode(
            fromTableId,
            { x: position.x - 460, y: position.y - 140 },
            undefined,
            { importRelatedConstraints: true, excludeConstraintId: resourceId }
          )
        : nodes.value.find((n) => n.id === fromTableId)
      // FK 的 to_schema 不传 importRelatedConstraints，避免雪崩式导入其关联约束
      const toSchema = includeDeps
        ? await ensureSchemaNode(toTableId, { x: position.x - 460, y: position.y + 140 })
        : nodes.value.find((n) => n.id === toTableId)

      logger.info('[constraint.ts] FK 节点导入 - 列信息:', {
        fromTableId,
        fromColId,
        sourceColumn: resolveColumnName(fromSchema, fromColId),
        toTableId,
        toColId,
        targetColumn: resolveColumnName(toSchema, toColId),
        toSchemaExists: !!toSchema,
      })

      buildInput = {
        mode: 'import',
        configName: c.description || 'ForeignKey',
        schemaNodeId: fromTableId,
        tableName: resolveTableName(fromSchema),
        nodeId: resourceId,
        nodeType,
        fkRefs: {
          source: {
            nodeId: fromTableId,
            columnId: fromColId,
            columnName: resolveColumnName(fromSchema, fromColId),
          },
          target: {
            nodeId: toTableId,
            columnId: toColId,
            columnName: resolveColumnName(toSchema, toColId),
          },
        },
        refs: { ...refs, to_table_name: resolveTableName(toSchema) },
        params: cParams,
      }
    } else if (c.type === 'Conditional') {
      // Conditional 有 IF 条件 + THEN 列
      const tableId = refs.table_id as string
      const schemaNode = includeDeps
        ? await ensureSchemaNode(
            tableId,
            { x: position.x - 420, y: position.y },
            undefined,
            { importRelatedConstraints: true, excludeConstraintId: resourceId }
          )
        : nodes.value.find((n) => n.id === tableId)

      const thenColId = refs.then_column_id as string
      const ifLogic = String(refs.if_logic || 'and')
      const rawConditions = Array.isArray(refs.if_conditions)
        ? (refs.if_conditions as unknown[])
        : []

      const ifConditions = rawConditions.map((cond) => {
        const r = cond as Record<string, unknown>
        const ifColId = String(r?.if_column_id || '')
        return {
          operator: String(r?.operator ?? ''),
          value: r?.value,
          values: r?.values as unknown[] | undefined,
          columnId: ifColId,
          columnName: resolveColumnName(schemaNode, ifColId),
        }
      })

      buildInput = {
        mode: 'import',
        configName: c.description || 'Conditional',
        schemaNodeId: tableId,
        tableName: resolveTableName(schemaNode),
        nodeId: resourceId,
        nodeType,
        ifConditions,
        ifLogic,
        thenRef: thenColId
          ? {
              nodeId: tableId,
              columnId: thenColId,
              columnName: resolveColumnName(schemaNode, thenColId),
            }
          : undefined,
        thenConditionConfig: (cParams as Record<string, unknown>)?.then_condition,
        params: cParams,
      }
    } else if (c.type === 'Unique') {
      // Unique 使用 column_ids（复数）
      const tableId = refs.table_id as string
      const colIds = Array.isArray(refs.column_ids) ? (refs.column_ids as string[]) : []
      const schemaNode = includeDeps
        ? await ensureSchemaNode(
            tableId,
            { x: position.x - 420, y: position.y },
            undefined,
            { importRelatedConstraints: true, excludeConstraintId: resourceId }
          )
        : nodes.value.find((n) => n.id === tableId)

      buildInput = {
        mode: 'import',
        configName: c.description || 'Unique',
        schemaNodeId: tableId,
        tableName: resolveTableName(schemaNode),
        nodeId: resourceId,
        nodeType,
        columnRef:
          colIds.length > 0 && colIds[0]
            ? {
                nodeId: tableId,
                columnId: colIds[0],
                columnName: resolveColumnName(schemaNode, colIds[0]),
              }
            : undefined,
        params: cParams,
      }
    } else {
      // 通用单列约束：NotNull, AllowedValues, Range, Scripted, Charset, DateLogic, Composite
      const tableId = (refs.table_id as string) || ''
      const colId = (refs.column_id as string) || ''
      const schemaNode =
        tableId && includeDeps
          ? await ensureSchemaNode(
              tableId,
              { x: position.x - 420, y: position.y },
              undefined,
              { importRelatedConstraints: true, excludeConstraintId: resourceId }
            )
          : nodes.value.find((n) => n.id === tableId)

      buildInput = {
        mode: 'import',
        configName: c.description || c.type || 'Constraint',
        schemaNodeId: tableId,
        tableName: resolveTableName(schemaNode),
        nodeId: resourceId,
        nodeType,
        columnRef:
          tableId && colId
            ? { nodeId: tableId, columnId: colId, columnName: resolveColumnName(schemaNode, colId) }
            : undefined,
        params: cParams,
      }
    }

    // ========================================================================
    // 使用 NodeDataBuilder 构建节点数据
    // ========================================================================

    const result = buildNodeData(kind, buildInput)

    // 创建节点
    const constraintNode: CustomNode = {
      id: resourceId,
      type: nodeType,
      position,
      data: result.nodeData as unknown as CustomNodeData,
    }
    addNodes(constraintNode)
    // addNodes() 只更新 Vue Flow 内部状态，不会同步到 Pinia store 的 nodes ref
    // （v-model 同步在 nextTick 才触发）。手动同步确保本 tick 内的后续节点查找
    // （如 ensureSchemaNode / nodes.value.find）能正确找到该节点，避免重复创建。
    nodes.value = [...nodes.value, constraintNode]

    // 创建边
    applyEdgeDescriptors(result.edgeDescriptors, resourceId)

    selectedNodeId.value = constraintNode.id
    return constraintNode.id
  }

  /** 根据 EdgeDescriptor 列表创建实际的边 */
  function applyEdgeDescriptors(descriptors: EdgeDescriptor[], _constraintId: string) {
    for (const desc of descriptors) {
      if (desc.kind === 'constraint' || desc.kind === 'if') {
        // 普通约束边 / Conditional IF 边
        ensureSchemaToConstraintEdge(desc.sourceNodeId, desc.targetNodeId, desc.columnId)
      } else if (desc.kind === 'fkDisplay') {
        const extra = desc.extra || {}
        const edgeId = (extra.edgeId as string) || `fk-${desc.sourceNodeId}-${desc.targetNodeId}`
        bufferEdge({
          id: edgeId,
          source: desc.sourceNodeId,
          target: desc.targetNodeId,
          sourceHandle: desc.sourceHandle,
          targetHandle: desc.targetHandle,
          type: 'smoothstep',
          animated: false,
          label: extra.label,
          class: 'fk-display-edge',
          style: { stroke: 'var(--edge-fk-display)', strokeWidth: 1.6, strokeDasharray: '2 8' },
          data: {
            kind: 'fkDisplay',
            constraintId: extra.constraintId,
            fromTableId: extra.fromTableId,
            toTableId: extra.toTableId,
            fromColumnId: extra.fromColumnId,
            toColumnId: extra.toColumnId,
          },
        } as unknown as Edge)
      }
    }
  }

  return { importConstraint }
}
