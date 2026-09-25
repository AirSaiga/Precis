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

import { nextTick, type Ref } from 'vue'
import type { Edge } from '@vue-flow/core'
import type { CustomNode, CustomNodeData } from '@/types/graph'
import type { SchemaNodeData } from '@/types/nodes'
import type { ConstraintKind } from '@/services/constraints/types'
import { getV2RegexNode } from '@/api/projectV2Api'
import { buildNodeData } from '@/services/constraints/nodeDataBuilder'
import { addNodes, removeEdges, removeNodes, updateNode } from '@/services/canvas/vueFlowApi'
import { nodeDataKeys } from '../shared/nodeDataRead'
import { logger } from '@/core/utils/logger'

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
  edges: Ref<Edge[]>
  selectedNodeId: Ref<string | null>
  ensureSchemaNode: (tableId: string, position: { x: number; y: number }) => Promise<CustomNode>
  ensureSchemaToRegexEdge: (tableId: string, regexId: string, columnId: string) => void
  ensureSchemaToRegexExtractEdge: (tableId: string, regexId: string, columnId: string) => void
  /** 节点 data 唯一修改入口（原地刷新用，graphStore state 模块注入） */
  updateNodeData: (nodeId: string, patches: Partial<CustomNodeData>) => void
}) {
  const {
    nodes,
    edges,
    selectedNodeId,
    ensureSchemaNode,
    ensureSchemaToRegexEdge,
    ensureSchemaToRegexExtractEdge,
    updateNodeData,
  } = params

  async function importRegex(
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
        // 走 vueFlowApi.updateNode 更新位置，与 importV2ResourceToCanvas 一致：
        // 直接改 node.position 会绕过 Vue Flow 内部 state 同步（store 变了但渲染不变）
        updateNode(resourceId, { position: { ...position } })
      }
      selectedNodeId.value = resourceId
      return resourceId
    }
    if (existingNode) {
      // 刷新路径：先清该节点旧入边（source_ref 列引用可能已变），data 构建后原地刷新并按磁盘重建
      for (const edge of edges.value.filter((e) => e.target === resourceId)) {
        removeEdges(edge.id)
      }
    }

    const r = await getV2RegexNode(resourceId)
    const v2SourceRef = r.source_ref
      ? { nodeId: String(r.source_ref.table_id), v2ColumnId: String(r.source_ref.column_id) }
      : null
    const v2ColumnName = (r.source_column_name as string) || ''

    // 依赖 Schema 守卫（includeDeps=false 且 source_ref 的表节点不在画布）：
    // 磁盘上有 → 先 ensureSchemaNode 裸补依赖（同 constraint.ts 的守卫语义）；
    // 磁盘上也没有 → 返回空串而非建空列名半成品，对账 executor 记 failed。
    // 无 source_ref 的自由 regex 无依赖，不受影响。
    if (
      !includeDeps &&
      v2SourceRef?.nodeId &&
      !nodes.value.some((n) => n.id === v2SourceRef.nodeId)
    ) {
      try {
        await ensureSchemaNode(v2SourceRef.nodeId, { x: position.x - 420, y: position.y })
      } catch (e) {
        logger.warn(
          `[regex.ts] 依赖 Schema ${v2SourceRef.nodeId} 不在画布且磁盘上不可用，跳过导入（不建半成品节点）: ${resourceId}`,
          e
        )
        return ''
      }
    }

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

    if (!existingNode) {
      addNodes(regexNode)
      // addNodes 是 Vue Flow 增量 API，先等 nextTick 完成 model→store 回写再建边：
      // 边路径计算依赖节点渲染后的 handleBounds（见 AGENTS.md 时序约定），
      // 禁止手动 spread 追加 nodes.value 绕过 Vue Flow 内部状态管理。
      await nextTick()
    } else if (existingNode.type !== nodeType) {
      // 类型翻转（match_mode full ↔ extract 使 regex ↔ regexExtract）：node type 是
      // 节点级字段无法原地改，按删旧建新处理（位置保留）
      removeNodes([resourceId])
      addNodes({ ...regexNode, position: { ...existingNode.position } })
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
    for (const desc of result.edgeDescriptors) {
      if (desc.kind === 'constraint' || desc.kind === 'if') {
        if (isExtract) {
          ensureSchemaToRegexExtractEdge(desc.sourceNodeId, resourceId, desc.columnId)
        } else {
          ensureSchemaToRegexEdge(desc.sourceNodeId, resourceId, desc.columnId)
        }
      }
    }

    // 刷新路径不抢选中（对账是后台同步语义，选中应留给用户）
    if (!existingNode) {
      selectedNodeId.value = regexNode.id
    }
    return resourceId
  }

  return { importRegex }
}
