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
 * @file embeddedConstraints.ts
 * @description V2 内嵌约束物化模块
 *
 * 将 schema.yaml 中内嵌的 constraints 字段物化为画布上的 Constraint 节点和边。
 * 通过 NodeDataBuilder 统一构建节点数据，确保与独立约束导入路径一致。
 *
 * 功能概述：
 * - materializeV2EmbeddedConstraints: 主入口，遍历 schema 的 embeddedConstraints
 * - 按约束类型通过 buildNodeData 创建对应的 Constraint 节点
 * - 自动建立 Constraint 节点到 Schema 列的边
 * - 去重检查：避免创建重复的约束节点
 *
 * 架构设计：
 * - 纯函数设计，接收 schemaNode + 工具函数作为参数
 * - 名称字段（column / from_column 等）严格解析：顶层裸名 / 嵌套「父.子」全限定路径，
 *   不接受列 ID、不做递归裸名猜测（columnRefResolver，与后端 embedded_constraints 同一约定）；
 *   解析不到视为配置错误，跳过该约束（后端同口径报错丢弃）
 * - ID 字段（then_column_id / if_column_id / column_id）按列 ID 直查
 * - 嵌套子列约束的连线挂到顶层祖先列的 handle（rootColumnId），节点展示/持久化用全限定名
 * - 使用 hasNode / addNode / addConstraintEdge 回调与外部状态交互
 */

import type { CustomNode } from '@/types/graph'
import {
  getConstraintKindByV2Type,
  getConstraintNodeTypeByV2Type,
} from '@/services/constraints/validationRegistry'
import type { BuildInput } from '@/services/constraints/nodeDataBuilder'
import { buildNodeData } from '@/services/constraints/nodeDataBuilder'
import {
  buildColumnRefResolver,
  type ColumnRefNode,
  type ResolvedColumnRef,
} from '@/services/constraints/columnRefResolver'
import { logger } from '@/core/utils/logger'
interface EmbeddedConstraintItem {
  id?: string | number
  type?: string
  column?: string
  description?: string
  // ForeignKey 内嵌约束的表/列名引用（宿主 schema 即 from_table，与 schemaBuilder 导出格式一致）
  from_table?: string
  from_column?: string
  to_table?: string
  to_column?: string
  params?: {
    allowed_values?: unknown[]
    min?: unknown
    max?: unknown
    expression?: unknown
    name?: unknown
    charset_mode?: unknown
    allowed_chars?: unknown
    disallowed_chars?: unknown
    logic_mode?: unknown
    start_date?: unknown
    end_date?: unknown
    date_format?: unknown
    [key: string]: unknown
  }
  // Conditional 内嵌约束的 refs 字段
  refs?: {
    if_conditions?: unknown[]
    if_logic?: string
    then_column_id?: string
    [key: string]: unknown
  }
}

export function materializeV2EmbeddedConstraints(params: {
  schemaNode: CustomNode
  schemaTableName: string
  embeddedConstraints: EmbeddedConstraintItem[]
  /** 宿主 schema 的列树（V2 文件/AI spec/JsonSchema 节点列），用于精确解析列引用 */
  columnTree: ColumnRefNode[]
  hasNode: (id: string) => boolean
  addNode: (node: CustomNode) => void
  addConstraintEdge: (tableId: string, constraintId: string, columnId: string) => void
}) {
  const {
    schemaNode,
    schemaTableName,
    embeddedConstraints,
    columnTree,
    hasNode,
    addNode,
    addConstraintEdge,
  } = params

  // 名称字段严格解析：顶层裸名 / 嵌套「父.子」全限定路径（与后端 embedded_constraints 同约定）
  const resolver = buildColumnRefResolver(columnTree)
  /** 列 ID -> 全限定显示名（未知 ID 返回空串） */
  const columnNameById = (columnId: string): string => resolver.byId(columnId)?.columnName ?? ''
  /** 列 ID -> 顶层祖先列 id（连线 handle 用；顶层列即自身） */
  const rootColumnIdOf = (columnId: string): string =>
    resolver.byId(columnId)?.rootColumnId ?? columnId
  /** if/then 列引用解析：ID 字段按列 ID 直查（不接受列名） */
  const resolveRefColumnId = (value: string): string => {
    if (!value) return ''
    return resolver.byId(value)?.columnId ?? ''
  }

  embeddedConstraints.forEach((item: EmbeddedConstraintItem, idx: number) => {
    if (!item?.id) return

    const rawId = String(item.id)
    const id = rawId.startsWith(`${schemaNode.id}_`) ? rawId : `${schemaNode.id}_${rawId}`

    if (hasNode(id)) return

    const nodeType = getConstraintNodeTypeByV2Type(item.type ?? '') ?? 'constraint'
    const basePos = { x: schemaNode.position.x + 420, y: schemaNode.position.y + idx * 160 }
    const kind = getConstraintKindByV2Type(item.type ?? '')

    // 名称字段严格解析：顶层裸名 / 嵌套「父.子」全限定路径，不接受列 ID。
    // Conditional 除外：其 column 字段承载 THEN 列 ID（保存契约），属 ID 语义，按 ID 直查
    const isConditional = item.type === 'Conditional'
    const colName = !isConditional && item.column ? String(item.column) : ''
    const resolvedColumn: ResolvedColumnRef | undefined = colName
      ? resolver.resolve(colName)
      : undefined
    if (colName && !resolvedColumn) {
      // 与后端 embedded_constraints 同口径：解析不到视为配置错误，跳过该约束
      logger.warn(
        `[embeddedConstraints] 内嵌约束 ${id} 的列引用 "${colName}" 在 schema ${schemaNode.id} 中无法解析，已跳过（顶层列用裸名，嵌套子列用「父.子」路径）`
      )
      return
    }

    // 构建 BuildInput
    let buildInput: BuildInput

    if (item.type === 'Conditional') {
      // Conditional 内嵌约束 — 解析 IF 条件和 THEN 列
      // 优先从 params 读取（与 schemaBuilder / embeddedConstraintBuilder 导出格式一致），兼容旧版 refs
      const itemParams = (item.params || {}) as Record<string, unknown>
      const itemRefs = (item.refs || itemParams) as Record<string, unknown>
      const ifLogic = String(itemRefs.if_logic || itemParams.if_logic || 'and')
      // THEN 列：then_column_id 即列 ID，按 ID 直查；旧格式（无 then_column_id）回退 base.column（同样按 ID 解析）
      const thenRaw = String(
        itemRefs.then_column_id || itemParams.then_column_id || item.column || ''
      )
      const thenColId = resolveRefColumnId(thenRaw)

      const rawConditions = Array.isArray(itemRefs.if_conditions || itemParams.if_conditions)
        ? ((itemRefs.if_conditions || itemParams.if_conditions) as unknown[])
        : []
      const ifConditions = rawConditions.map((cond) => {
        const r = cond as Record<string, unknown>
        // if_column_id 即列 ID，直通（UUID 不再误当列名查 colNameToId）
        const ifColId = resolveRefColumnId(String(r?.if_column_id || ''))
        return {
          operator: String(r?.operator ?? ''),
          value: r?.value,
          values: r?.values as unknown[] | undefined,
          columnId: ifColId,
          columnName: columnNameById(ifColId),
        }
      })

      buildInput = {
        mode: 'embedded',
        configName: item.description || id,
        schemaNodeId: schemaNode.id,
        tableName: schemaTableName,
        nodeId: id,
        nodeType,
        embedded: true,
        ifConditions,
        ifLogic,
        thenRef: thenColId
          ? {
              nodeId: schemaNode.id,
              columnId: thenColId,
              columnName: columnNameById(thenColId),
            }
          : undefined,
        thenConditionConfig: itemParams.then_condition,
        // params 透传：skip_if 开关由 builder 读取（input.params.skip_if），保证 roundtrip 不复位
        params: item.params as Record<string, unknown> | undefined,
      }
    } else if (item.type === 'ForeignKey') {
      // ForeignKey 内嵌约束 — from_table/from_column/to_table/to_column 均为名（列名简化写法）。
      // 宿主 schema 即 from_table（与后端 embedded_constraints 一致，refs.from_table_id = schema.id）；
      // to_table 为跨表引用，物化入口无其他 schema 节点的访问能力——目标按名保留
      // （targetRef 置空、不建 FK 展示边），需要全量恢复时走独立导入路径（import/constraint.ts）
      const fromColName = item.from_column ? String(item.from_column) : ''
      const fromResolved = fromColName ? resolver.resolve(fromColName) : undefined
      if (fromColName && !fromResolved) {
        // 名称字段严格解析：解析不到视为配置错误，跳过该约束（与后端同口径）
        logger.warn(
          `[embeddedConstraints] 内嵌 FK 约束 ${id} 的列引用 "${fromColName}" 在 schema ${schemaNode.id} 中无法解析，已跳过`
        )
        return
      }
      const fromColId = fromResolved?.columnId ?? ''
      const toTableName = item.to_table ? String(item.to_table) : ''
      const toColName = item.to_column ? String(item.to_column) : ''

      buildInput = {
        mode: 'embedded',
        configName: item.description || id,
        schemaNodeId: schemaNode.id,
        tableName: schemaTableName,
        nodeId: id,
        nodeType,
        embedded: true,
        fkRefs: {
          source: {
            nodeId: schemaNode.id,
            columnId: fromColId,
            columnName: fromResolved?.columnName ?? fromColName,
          },
          target: { nodeId: '', columnId: '', columnName: toColName },
        },
        // builder 从 refs.to_table_name 取目标表显示名
        refs: toTableName ? { to_table_name: toTableName } : undefined,
        // params 透传：allow_null 开关由 builder 读取（input.params.allow_null），保证 roundtrip 不复位
        params: item.params as Record<string, unknown> | undefined,
      }
    } else {
      // 通用单列约束
      buildInput = {
        mode: 'embedded',
        configName: item.description || id,
        schemaNodeId: schemaNode.id,
        tableName: schemaTableName,
        nodeId: id,
        nodeType,
        embedded: true,
        columnRef: resolvedColumn
          ? {
              nodeId: schemaNode.id,
              columnId: resolvedColumn.columnId,
              columnName: resolvedColumn.columnName,
            }
          : undefined,
        params: item.params as Record<string, unknown> | undefined,
      }
    }

    // 使用 NodeDataBuilder 构建节点数据
    const result = kind
      ? buildNodeData(kind, buildInput)
      : {
          // 未知类型的降级
          nodeData: {
            embedded: true,
            configName: item.description || id,
            saveState: 'saved',
          } as Record<string, unknown>,
          edgeDescriptors: [] as Array<{
            kind: 'constraint'
            sourceNodeId: string
            targetNodeId: string
            columnId: string
          }>,
        }

    addNode({
      id,
      type: nodeType,
      position: basePos,
      // builder 产出宽松 Record<string, unknown>，与 CustomNodeData 联合无足够重叠，
      // 单断言编译不过（TS2352），此处为注册表 builder 出口的标准接收方式（同 import/constraint.ts）
      data: result.nodeData as unknown as CustomNode['data'],
    })

    // 创建边（嵌套子列约束挂到顶层祖先列的 handle）
    for (const desc of result.edgeDescriptors) {
      if (desc.kind === 'constraint' || desc.kind === 'if') {
        addConstraintEdge(desc.sourceNodeId, desc.targetNodeId, rootColumnIdOf(desc.columnId))
      }
    }
  })
}
