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

import { nextTick, type Ref } from 'vue'
import type { Edge } from '@vue-flow/core'
import type { CustomNode, CustomNodeData } from '@/types/graph'
import type { SchemaNodeData } from '@/types/nodes'
import type { TableSchemaFileV2 } from '@/types/projectV2'
import {
  getConstraintKindByV2Type,
  getConstraintNodeTypeByV2Type,
} from '@/services/constraints/validationRegistry'
import type { BuildInput, EdgeDescriptor } from '@/services/constraints/nodeDataBuilder'
import { getV2Constraint, getV2Schema } from '@/api/projectV2Api'
import { buildNodeData } from '@/services/constraints/nodeDataBuilder'
import {
  buildColumnRefResolver,
  type ResolvedColumnRef,
} from '@/services/constraints/columnRefResolver'
import { logger } from '@/core/utils/logger'
import { addNodes, removeEdges, removeNodes, updateNode } from '@/services/canvas/vueFlowApi'
import { nodeDataGet, nodeDataKeys } from '../shared/nodeDataRead'
/** 从 Schema 节点中查找列名 */
function resolveColumnName(schemaNode: CustomNode | undefined, columnId: string): string {
  if (!schemaNode) return ''
  return (
    ((schemaNode.data as SchemaNodeData | undefined)?.columns || []).find(
      (x) => (x as { id?: string; columnName?: string }).id === columnId
    )?.columnName || ''
  )
}

/**
 * 解析独立约束的列引用：顶层列按 id 在 Schema 节点上直查；
 * 查不到（可能为嵌套子列）时拉取 V2 列树，按「全限定名 / 列 ID」精确解析出
 * 真实列 id、全限定显示名与顶层祖先列 id（连线 handle 用）。
 */
async function resolveConstraintColumnRef(
  tableId: string,
  colId: string,
  schemaNode: CustomNode | undefined
): Promise<ResolvedColumnRef | undefined> {
  const topName = resolveColumnName(schemaNode, colId)
  if (topName) return { columnId: colId, columnName: topName, rootColumnId: colId }
  try {
    const schemaFile = await getV2Schema(tableId)
    // refs.column_id 是 ID 字段：按列 ID 在列树中直查（含嵌套子列）
    const resolved = buildColumnRefResolver(schemaFile?.columns).byId(colId)
    if (!resolved) {
      logger.warn(`[constraint.ts] 列 ID ${colId} 在 schema ${tableId} 的列树中不存在`)
    }
    return resolved
  } catch (e) {
    logger.warn(
      `[constraint.ts] 拉取 schema ${tableId} 列树失败，列引用 ${colId} 无法解析: ${String(e)}`
    )
    return undefined
  }
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
  /** 节点 data 唯一修改入口（原地刷新用，graphStore state 模块注入） */
  updateNodeData: (nodeId: string, patches: Partial<CustomNodeData>) => void
}) {
  const {
    nodes,
    edges,
    selectedNodeId,
    ensureSchemaNode,
    ensureSchemaToConstraintEdge,
    bufferEdge,
    updateNodeData,
  } = params

  async function importConstraint(
    resourceId: string,
    position: { x: number; y: number },
    options?: { includeDeps?: boolean; moveIfExists?: boolean; refreshExisting?: boolean }
  ): Promise<string> {
    const includeDeps = options?.includeDeps !== false
    const moveIfExists = options?.moveIfExists === true
    const refreshExisting = options?.refreshExisting === true

    const existingNode = nodes.value.find((n) => n.id === resourceId)
    if (existingNode && !refreshExisting) {
      if (moveIfExists) {
        // 走 vueFlowApi.updateNode 更新位置，与 regex.ts/importV2ResourceToCanvas 一致：
        // 直接改 node.position 会绕过 Vue Flow 内部 state 同步（store 变了但渲染不变）
        updateNode(resourceId, { position: { ...position } })
      }
      selectedNodeId.value = resourceId
      return resourceId
    }
    if (existingNode) {
      // 刷新路径：先清该节点的旧边，data 构建后原地刷新并按磁盘重建。两类边：
      // - 入边（schema→constraint，target===resourceId）：引用列可能已变
      // - FK 展示边（constraint→to_schema，source===resourceId 且 data.kind==='fkDisplay'）：
      //   UPDATE 的 to_table 后旧虚线边残留、仅改 from_column 时 label 停留旧列名，须一并清
      for (const edge of edges.value.filter(
        (e) =>
          e.target === resourceId ||
          (e.source === resourceId && nodeDataGet(e.data, 'kind') === 'fkDisplay')
      )) {
        removeEdges(edge.id)
      }
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

    // 依赖 Schema 守卫（includeDeps=false 且引用的表节点不在画布）：
    // - 磁盘上存在 → 先 ensureSchemaNode 裸补依赖（不级联该 schema 的其他约束，
    //   防雪崩语义保持），再走正常导入——覆盖"schema 在磁盘、尚未上画布"的时序
    //   （如 hydrate 未完成时对账先到）；
    // - 磁盘上也没有（getV2Schema 抛错）→ 返回空串而非建空列名半成品
    //   （buildInput 的 columnRef/columnName 解析不到会全空）。对账 executor 据空串
    //   记 failed，走既有失败呈现（toast + "建议重新加载项目"）——等价覆盖 v1
    //   handler 的 targetNodeNotFound 拒绝语义。includeDeps=true 时 ensureSchemaNode
    //   已在分支内保证存在，不受影响。
    if (!includeDeps) {
      const requiredTableIds =
        c.type === 'ForeignKey'
          ? [String(refs.from_table_id || ''), String(refs.to_table_id || '')]
          : [String(refs.table_id || '')]
      for (const tableId of requiredTableIds.filter(Boolean)) {
        if (nodes.value.some((n) => n.id === tableId)) continue
        try {
          await ensureSchemaNode(tableId, { x: position.x - 420, y: position.y })
        } catch (e) {
          logger.warn(
            `[constraint.ts] 依赖 Schema ${tableId} 不在画布且磁盘上不可用，跳过导入（不建半成品节点）: ${resourceId}`,
            e
          )
          return ''
        }
      }
    }

    // ========================================================================
    // 解析 Schema 节点和列名 — 根据约束类型不同有不同的引用结构
    // ========================================================================

    let buildInput: BuildInput

    // 已解析列引用的 列ID -> 顶层祖先列ID 映射（嵌套子列约束的连线挂到顶层列 handle）
    const rootColumnIdByRef = new Map<string, string>()

    /** 单列引用解析：顶层直查，嵌套走列树；顺带登记 列ID -> 顶层祖先列ID */
    const resolveSingleColumnRef = async (
      refTableId: string,
      refColId: string,
      refSchemaNode: CustomNode | undefined
    ) => {
      if (!refTableId || !refColId) return undefined
      const resolved = await resolveConstraintColumnRef(refTableId, refColId, refSchemaNode)
      if (!resolved) return undefined
      rootColumnIdByRef.set(resolved.columnId, resolved.rootColumnId)
      return { nodeId: refTableId, columnId: resolved.columnId, columnName: resolved.columnName }
    }

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
        ? await ensureSchemaNode(tableId, { x: position.x - 420, y: position.y }, undefined, {
            importRelatedConstraints: true,
            excludeConstraintId: resourceId,
          })
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
        ? await ensureSchemaNode(tableId, { x: position.x - 420, y: position.y }, undefined, {
            importRelatedConstraints: true,
            excludeConstraintId: resourceId,
          })
        : nodes.value.find((n) => n.id === tableId)

      buildInput = {
        mode: 'import',
        configName: c.description || 'Unique',
        schemaNodeId: tableId,
        tableName: resolveTableName(schemaNode),
        nodeId: resourceId,
        nodeType,
        columnRef: await resolveSingleColumnRef(tableId, colIds[0] || '', schemaNode),
        params: cParams,
      }
    } else {
      // 通用单列约束：NotNull, AllowedValues, Range, Scripted, Charset, DateLogic, Composite
      const tableId = (refs.table_id as string) || ''
      const colId = (refs.column_id as string) || ''
      const schemaNode =
        tableId && includeDeps
          ? await ensureSchemaNode(tableId, { x: position.x - 420, y: position.y }, undefined, {
              importRelatedConstraints: true,
              excludeConstraintId: resourceId,
            })
          : nodes.value.find((n) => n.id === tableId)

      buildInput = {
        mode: 'import',
        configName: c.description || c.type || 'Constraint',
        schemaNodeId: tableId,
        tableName: resolveTableName(schemaNode),
        nodeId: resourceId,
        nodeType,
        columnRef: await resolveSingleColumnRef(tableId, colId, schemaNode),
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

    if (!existingNode) {
      addNodes(constraintNode)
      // addNodes 是 Vue Flow 增量 API，先等 nextTick 完成 model→store 回写再建边：
      // 边路径计算依赖节点渲染后的 handleBounds（见 AGENTS.md 时序约定），
      // 禁止手动 spread 追加 nodes.value 绕过 Vue Flow 内部状态管理。
      await nextTick()
    } else if (existingNode.type !== nodeType) {
      // 类型已变（如 NotNull→Range）：node type 是节点级字段无法原地改，删旧建新（位置保留）
      removeNodes([resourceId])
      addNodes({ ...constraintNode, position: { ...existingNode.position } })
      await nextTick()
    } else {
      // 原地刷新 data（磁盘为准）：整体替换语义——旧 data 独有字段补 undefined，
      // 并重置校验状态（参数已变，旧结果失效）
      const patch: Record<string, unknown> = {
        ...result.nodeData,
        validationStatus: 'idle',
        validationErrors: [],
        lastValidation: undefined,
      }
      for (const key of nodeDataKeys(existingNode.data)) {
        if (!(key in patch)) patch[key] = undefined
      }
      updateNodeData(resourceId, patch as Partial<CustomNodeData>)
      await nextTick()
    }

    // 创建边
    applyEdgeDescriptors(
      result.edgeDescriptors,
      resourceId,
      (columnId) => rootColumnIdByRef.get(columnId) ?? columnId
    )

    // 刷新路径不抢选中（对账是后台同步语义，选中应留给用户）
    if (!existingNode) {
      selectedNodeId.value = constraintNode.id
    }
    return resourceId
  }

  /** 根据 EdgeDescriptor 列表创建实际的边（columnIdToRoot 把嵌套子列映射到顶层祖先 handle） */
  function applyEdgeDescriptors(
    descriptors: EdgeDescriptor[],
    _constraintId: string,
    columnIdToRoot: (columnId: string) => string = (id) => id
  ) {
    for (const desc of descriptors) {
      if (desc.kind === 'constraint' || desc.kind === 'if') {
        // 普通约束边 / Conditional IF 边
        ensureSchemaToConstraintEdge(
          desc.sourceNodeId,
          desc.targetNodeId,
          columnIdToRoot(desc.columnId)
        )
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
