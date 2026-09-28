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
 * @fileoverview 约束卡片密度管理器 —— fingerprint computed + 防抖 watch 驱动
 * "每 Schema 家族约束数 > 阈值 → 该家族约束卡片默认紧凑条"的密度收敛
 *
 * 架构（前身 dockSync 同款骨架）：
 * - fingerprint 只拼影响密度决策的轻量字段：schema 高度/列签名（阈值与行派生
 *   输入）、约束 id/type/sourceRef/label（挂靠与家族成员）。刻意不含：
 *   约束卡片 density/densityPinned（管理器自写，防回环）、validationStatus
 *   （与密度无关）、节点位置（密度与落位无关）。
 * - watcher 挂 graphStore（随 store 生命周期），单点覆盖全部 mutation 入口
 *   （手动连线 / AI 指令 / 导入 / 模板展开 / undo / 删除）。
 * - 密度写入走注入的 updateNodeData（state.ts 路由）；用户钉住
 *   （densityPinned === true）的节点跳过——显式选择优先于阈值默认。
 *
 * 保留的纯函数资产（后续"Schema 头部约束概览弹层"任务的地基，
 * 保持纯函数、参数注入、可单测）：
 * - deriveConstraintFamilies：每 schema 的约束行清单（列序 + 内嵌/独立 + 表级沉底）
 * - computeDensityThreshold：动态阈值公式（与旧 computeDockThreshold 语义一致）
 *
 * Vue Flow 纪律：本模块不建/删节点与边（坞退役后无派生图元素），
 * 仅经 updateNodeData 写约束节点 data.density。
 */

import { computed, watch, type Ref } from 'vue'
import type { Edge } from '@vue-flow/core'
import type {
  CustomNode,
  CustomNodeData,
  SchemaNodeData,
  JsonSchemaNodeData,
  BaseSchemaColumn,
} from '@/types/graph'
import {
  isConstraintNodeType,
  getConstraintKindByNodeType,
} from '@/services/constraints/validationRegistry'
import { logger } from '@/core/utils/logger'

// ============================================================================
// 密度阈值（动态计算；产品确认：> 阈值该家族卡片默认紧凑）
//
// threshold = clamp( round( max(schemaHeight, viewportHeight × 0.7) / 130 ), 4, 16 )
//   - 130 = 全卡约束高度（对齐 features/node-layout-organizer 的 NODE_DIMENSIONS.CONSTRAINT_HEIGHT；
//     不直接 import 是为避免 store→feature 反向依赖，两处需人工同步）
//   - schemaHeight 走既有尺寸候选链：Vue Flow node.dimensions → data.height → 兜底估算
//   - viewportHeight 取 Vue Flow 容器实测高度；取不到时按 800px 兜底
//   - 下限 4：卡片太少不值得紧凑；上限 16：防大屏下密度翻转频繁
// ============================================================================

/** 全卡约束高度（px）——阈值公式分母，语义对齐 NODE_DIMENSIONS.CONSTRAINT_HEIGHT */
export const DENSITY_CARD_HEIGHT_PX = 130

/** 阈值公式的视口参与比例：max(schemaHeight, viewport × 0.7) 构成"可视高度预算" */
export const DENSITY_VIEWPORT_RATIO = 0.7

/** 视口高度兜底：画布未挂载 / DOM 不可读时按 800px 估算 */
export const DENSITY_VIEWPORT_FALLBACK_HEIGHT_PX = 800

/** 阈值下限：少于 4 张卡片不值得紧凑（紧凑条的交互成本高于收益） */
export const DENSITY_THRESHOLD_MIN = 4

/** 阈值上限：大屏 / 高 schema 下防密度语义无限放宽 */
export const DENSITY_THRESHOLD_MAX = 16

/** Schema 高度兜底（无实测尺寸时；语义对齐 NODE_DIMENSIONS.DEFAULT_HEIGHT） */
export const DENSITY_FALLBACK_SCHEMA_HEIGHT = 170

/**
 * 计算单个 Schema 家族的密度阈值（纯函数）。
 *
 * @param schemaHeight 宿主 Schema 高度（尺寸候选链解析后的值，px）
 * @param viewportHeight 画布视口高度（px）
 * @returns clamp(round(max(schemaHeight, viewport × 0.7) / 130), 4, 16)
 */
export function computeDensityThreshold(schemaHeight: number, viewportHeight: number): number {
  const basis = Math.max(schemaHeight, viewportHeight * DENSITY_VIEWPORT_RATIO)
  if (!Number.isFinite(basis) || basis <= 0) return DENSITY_THRESHOLD_MIN
  const raw = Math.round(basis / DENSITY_CARD_HEIGHT_PX)
  return Math.min(DENSITY_THRESHOLD_MAX, Math.max(DENSITY_THRESHOLD_MIN, raw))
}

/** 读取 Vue Flow 容器高度（阈值公式的视口项；非响应式惰性读取） */
function readViewportHeight(): number {
  if (typeof document === 'undefined') return DENSITY_VIEWPORT_FALLBACK_HEIGHT_PX
  const pane = document.querySelector('.vue-flow')
  const height = pane?.getBoundingClientRect().height ?? 0
  return height > 0 ? height : DENSITY_VIEWPORT_FALLBACK_HEIGHT_PX
}

/** 防抖窗口：拖拽/导入/AI 等连续 mutation 归并为一次密度收敛 */
const SYNC_DEBOUNCE_MS = 300

// ============================================================================
// 纯函数：行派生（约束概览弹层地基，导出供单测与后续任务复用）
// ============================================================================

/** 约束行条目：某列（或表级）下一个约束在概览中的展示单元 */
export interface ConstraintRowEntry {
  /** 约束标识：独立约束=画布节点 id；内嵌=合成 id `inline-{columnId}-{kind}` */
  constraintId: string
  /** 约束种类：ConstraintKind（camelCase） */
  kind: string
  /** 挂靠的 Schema 列 ID；表级约束缺省 */
  columnId?: string
  /** 展示标签（约束名 / 内嵌约束的列内描述） */
  label: string
  /** 是否内嵌约束（schema 列内 constraints 字段，无画布节点） */
  embedded: boolean
}

/** 单个 Schema 家族的行派生结果 */
export interface ConstraintFamilyDerivation {
  schemaNodeId: string
  /** 家族标题展示名（概览弹层用） */
  configName: string
  schemaPosition: { x: number; y: number }
  schemaWidth: number
  /** 宿主 Schema 高度（尺寸候选链解析后，阈值公式输入） */
  schemaHeight: number
  /** 该家族的动态密度阈值（clamp(round(max(schemaHeight, viewport×0.7)/130), 4, 16)） */
  threshold: number
  /** 按 Schema 列序排列的行清单（表级/悬空约束沉底） */
  rows: ConstraintRowEntry[]
  /** 挂靠该 schema 的独立约束节点 id 集合 */
  standaloneIds: string[]
  /** 独立约束数是否超过密度阈值（> → 家族卡片默认紧凑） */
  shouldCompact: boolean
}

interface AttachedConstraint {
  node: CustomNode
  columnId?: string
}

function isSchemaNodeType(type: string | undefined): boolean {
  return type === 'schema' || type === 'jsonSchema'
}

function readSchemaData(node: CustomNode): SchemaNodeData | JsonSchemaNodeData {
  return node.data as SchemaNodeData | JsonSchemaNodeData
}

/** 读取 Vue Flow 实测尺寸（渲染后经 v-model 回写；渲染前缺席） */
function readNodeDimensions(node: CustomNode): { width: number; height: number } | null {
  const dim = (node as CustomNode & { dimensions?: { width: number; height: number } }).dimensions
  if (dim && dim.width > 0 && dim.height > 0) return dim
  return null
}

/** Schema 列 source handle 固定格式：source-right-{columnId} */
function parseColumnIdFromHandle(sourceHandle: string | null | undefined): string | undefined {
  if (!sourceHandle) return undefined
  const prefix = 'source-right-'
  return sourceHandle.startsWith(prefix) ? sourceHandle.slice(prefix.length) : undefined
}

/**
 * 收集每个 schema 挂靠的独立约束节点。
 * 挂靠判定（并集）：约束 data.sourceRef.nodeId 或 schema→约束的边；
 * columnId 优先 sourceRef，边挂靠回退解析 sourceHandle。
 */
function buildConstraintAttachments(
  nodes: ReadonlyArray<CustomNode>,
  edges: ReadonlyArray<Edge>
): Map<string, AttachedConstraint[]> {
  const bySchema = new Map<string, AttachedConstraint[]>()
  const attach = (schemaId: string, item: AttachedConstraint) => {
    const list = bySchema.get(schemaId)
    if (list) list.push(item)
    else bySchema.set(schemaId, [item])
  }

  for (const node of nodes) {
    if (!isConstraintNodeType(node.type)) continue
    const data = (node.data || {}) as { sourceRef?: { nodeId?: string; columnId?: string } }
    const schemaId = data.sourceRef?.nodeId
    if (schemaId) {
      attach(schemaId, { node, columnId: data.sourceRef?.columnId })
    }
  }

  const constraintIdsWithoutRef = new Set(
    nodes
      .filter((n) => isConstraintNodeType(n.type))
      .filter((n) => !((n.data || {}) as { sourceRef?: { nodeId?: string } }).sourceRef?.nodeId)
      .map((n) => n.id)
  )
  for (const edge of edges) {
    if (!constraintIdsWithoutRef.has(edge.target)) continue
    if (!isSchemaNodeType(nodes.find((n) => n.id === edge.source)?.type)) continue
    attach(edge.source, {
      node: nodes.find((n) => n.id === edge.target)!,
      columnId: parseColumnIdFromHandle(edge.sourceHandle),
    })
  }

  return bySchema
}

/** 内嵌约束行合成 id（无画布节点的列内约束） */
export function inlineConstraintRowId(columnId: string, kind: string): string {
  return `inline-${columnId}-${kind}`
}

/**
 * 派生全部 schema 家族的约束行清单（纯函数）。
 * 行序 = Schema 列序；每列先内嵌（columns[].constraints）后独立；
 * columnId 缺失或不在列集中的约束沉底。
 *
 * @param viewportHeight 视口高度（阈值公式输入；由调用方实测或兜底）
 */
export function deriveConstraintFamilies(
  nodes: ReadonlyArray<CustomNode>,
  edges: ReadonlyArray<Edge>,
  viewportHeight: number
): Map<string, ConstraintFamilyDerivation> {
  const attachments = buildConstraintAttachments(nodes, edges)
  const result = new Map<string, ConstraintFamilyDerivation>()

  for (const node of nodes) {
    if (!isSchemaNodeType(node.type)) continue

    const data = readSchemaData(node)
    const columns: BaseSchemaColumn[] = data.columns || []
    const attached = attachments.get(node.id) || []

    const rows: ConstraintRowEntry[] = []
    const consumed = new Set<string>()

    for (const column of columns) {
      // 内嵌约束（camelCase 键契约：notNull/unique 布尔、allowedValues 数组）
      const inline = column.constraints
      if (inline?.notNull) {
        rows.push({
          constraintId: inlineConstraintRowId(column.id, 'notNull'),
          kind: 'notNull',
          columnId: column.id,
          label: 'notNull',
          embedded: true,
        })
      }
      if (inline?.unique) {
        rows.push({
          constraintId: inlineConstraintRowId(column.id, 'unique'),
          kind: 'unique',
          columnId: column.id,
          label: 'unique',
          embedded: true,
        })
      }
      if (Array.isArray(inline?.allowedValues) && inline.allowedValues.length > 0) {
        rows.push({
          constraintId: inlineConstraintRowId(column.id, 'allowedValues'),
          kind: 'allowedValues',
          columnId: column.id,
          label: 'allowedValues',
          embedded: true,
        })
      }

      // 挂靠该列的独立约束
      for (const item of attached) {
        if (item.columnId === column.id) {
          const kind = getConstraintKindByNodeType(item.node.type) || ''
          const itemData = (item.node.data || {}) as {
            configName?: string
            constraintName?: string
          }
          rows.push({
            constraintId: item.node.id,
            kind,
            columnId: column.id,
            label: itemData.configName || itemData.constraintName || kind,
            embedded: false,
          })
          consumed.add(item.node.id)
        }
      }
    }

    // 表级 / 悬挂约束沉底（columnId 缺失，或指向已被删除的列）
    for (const item of attached) {
      if (consumed.has(item.node.id)) continue
      const kind = getConstraintKindByNodeType(item.node.type) || ''
      const itemData = (item.node.data || {}) as { configName?: string; constraintName?: string }
      rows.push({
        constraintId: item.node.id,
        kind,
        columnId: item.columnId,
        label: itemData.configName || itemData.constraintName || kind,
        embedded: false,
      })
    }

    const dim = readNodeDimensions(node)
    const schemaWidth =
      (dim?.width ?? 0) ||
      (typeof data.width === 'number' && data.width > 0 ? data.width : 0) ||
      360
    const schemaHeight =
      (dim?.height ?? 0) ||
      (typeof data.height === 'number' && data.height > 0 ? data.height : 0) ||
      DENSITY_FALLBACK_SCHEMA_HEIGHT
    const threshold = computeDensityThreshold(schemaHeight, viewportHeight)

    result.set(node.id, {
      schemaNodeId: node.id,
      configName: data.configName || data.tableName || node.id,
      schemaPosition: { x: node.position.x, y: node.position.y },
      schemaWidth,
      schemaHeight,
      threshold,
      rows,
      standaloneIds: attached.map((a) => a.node.id),
      shouldCompact: attached.length > threshold,
    })
  }

  return result
}

/**
 * 计算密度同步指纹（纯函数）：任何影响家族成员/阈值输入的状态变化都改变返回值。
 * 刻意排除：约束卡片 density/densityPinned（管理器自写，防收敛回环）、
 * validationStatus（与密度无关）、节点位置（密度与落位无关）。
 */
export function computeConstraintDensityFingerprint(
  nodes: ReadonlyArray<CustomNode>,
  edges: ReadonlyArray<Edge>
): string {
  let fp = ''
  for (const node of nodes) {
    if (isSchemaNodeType(node.type)) {
      const data = readSchemaData(node)
      const dim = readNodeDimensions(node)
      let colSig = ''
      for (const column of data.columns || []) {
        const inline = column.constraints
        const inlineSig = inline
          ? `${inline.notNull ? 1 : 0}${inline.unique ? 1 : 0}${
              Array.isArray(inline.allowedValues) ? inline.allowedValues.length : 0
            }`
          : ''
        colSig += `${column.id}:${column.columnName}:${inlineSig};`
      }
      // 高度参与（阈值输入）；位置/hidden 不参与（与密度无关）
      fp += `S|${node.id}|${dim?.height ?? data.height ?? 0}|${colSig}\n`
    } else if (isConstraintNodeType(node.type)) {
      const data = (node.data || {}) as {
        sourceRef?: { nodeId?: string; columnId?: string }
        densityPinned?: boolean
      }
      // densityPinned 计入指纹：用户钉住/取消钉住是低频显式动作，触发一次
      // 再收敛（取消钉住后由管理器按家族默认回写密度）；density 本身刻意
      // 不拼（管理器自写，防收敛回环）
      fp += `C|${node.id}|${node.type}|${data.sourceRef?.nodeId ?? ''}|${
        data.sourceRef?.columnId ?? ''
      }|${data.densityPinned ? 1 : 0}\n`
    }
  }
  // 只拼约束入边（sourceRef 缺失约束的拓扑挂靠判定输入）
  const constraintIdSet = new Set(
    nodes.filter((n) => isConstraintNodeType(n.type)).map((n) => n.id)
  )
  for (const edge of edges) {
    if (!constraintIdSet.has(edge.target)) continue
    fp += `E|${edge.id}|${edge.source}|${edge.target}|${edge.sourceHandle ?? ''}\n`
  }
  return fp
}

// ============================================================================
// 模块工厂：watcher + 密度收敛
// ============================================================================

export function createConstraintDensityModule(params: {
  nodes: Ref<CustomNode[]>
  edges: Ref<Edge[]>
  updateNodeData: (nodeId: string, newData: Partial<CustomNodeData>) => void
}) {
  const { nodes, edges, updateNodeData } = params

  const fingerprint = computed(() => computeConstraintDensityFingerprint(nodes.value, edges.value))

  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  watch(
    fingerprint,
    () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        syncDensity().catch((error) => {
          logger.warn('[constraintDensity] 密度同步失败：', error)
        })
      }, SYNC_DEBOUNCE_MS)
    },
    { flush: 'post' }
  )

  /**
   * 密度收敛（幂等）：按家族阈值给约束节点写 density。
   * - 家族约束数 > 阈值 → density: 'compact'
   * - 家族约束数 ≤ 阈值 → density: undefined（全卡）
   * - densityPinned === true 的节点跳过（用户显式选择优先）
   * - 不挂靠任何家族的孤儿约束 → undefined（全卡）
   * 只在值变化时写入（updateNodeData 原地合并，防无谓写放大）。
   */
  async function syncDensity(): Promise<void> {
    const viewportHeight = readViewportHeight()
    const families = deriveConstraintFamilies(nodes.value, edges.value, viewportHeight)

    const desiredByNodeId = new Map<string, 'compact' | undefined>()
    for (const family of families.values()) {
      const desired = family.shouldCompact ? 'compact' : undefined
      for (const id of family.standaloneIds) {
        desiredByNodeId.set(id, desired)
      }
    }

    for (const node of nodes.value) {
      if (!isConstraintNodeType(node.type)) continue
      const data = (node.data || {}) as {
        density?: 'compact' | 'full'
        densityPinned?: boolean
      }
      if (data.densityPinned === true) continue
      const desired = desiredByNodeId.get(node.id)
      const current = data.density === 'compact' ? 'compact' : undefined
      if (current === desired) continue
      updateNodeData(node.id, { density: desired })
    }
  }

  return {
    /** 立即收敛（跳过防抖；测试与确定性场景用） */
    syncDensity,
  }
}
