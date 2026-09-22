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
 * @fileoverview 约束坞同步器 —— fingerprint computed + 防抖 watch 驱动坞的建/拆/更新
 *
 * 架构（样板：setup/computed.ts 的 inlineSourceFingerprint）：
 * - fingerprint 只拼轻量字段（schema 位置/尺寸/列签名、约束 id/type/sourceRef/label、
 *   schema 相关边），刻意不含 hidden（约束卡片）与 validationStatus——
 *   前者会在"建坞隐藏卡片 → 状态变化 → 再同步"间形成回环，后者由坞组件
 *   computed 直读约束节点，避免高频校验回写触发 watcher 风暴。
 * - schema.hidden 计入 fingerprint（坞需镜像模板折叠等隐藏语义），但坞自身的
 *   hidden 变化不影响 fingerprint（坞节点不参与拼接），镜像无回环。
 * - watcher 挂 graphStore（随 store 生命周期），单点覆盖全部 mutation 入口
 *   （手动连线 / AI 指令 / 导入 / 模板展开 / undo / 删除）。
 *
 * Vue Flow 纪律：建坞走 addNodes（dockFactory），拆坞走 removeNodes，
 * hidden/position 更新走 updateNodeData（state.ts 路由为 node 级 patch）。
 *
 * L2 全部展开/收回（expandDockAll/collapseDockAll）：聚合的独立约束卡片
 * un-hide 后经 layoutBatchAsGrid 栅格（每列 6、列距 420、行距 60，同导入批次）
 * 落在坞右侧，computeClearanceShift 避让既有节点；展开态仅存会话
 * （dock data.expandedAll，坞不落盘）。
 *
 * 列行 → 坞行展示边（schema-to-dock-display）：聚合态下为"该列有约束"的
 * 每一列建一条 schema 列 handle → 坞 target handle 的虚线展示边
 * （先例：FK 展示边）。边 data.transient=true + kind=dockDisplay：
 * 不进撤销快照、不触发断开清理链、不进指纹；持久化豁免见
 * buildV2ProjectView（view 只存节点坐标，坞与展示边均不落盘）。
 */

import { computed, watch, type Ref } from 'vue'
import type { Edge } from '@vue-flow/core'
import type {
  CustomNode,
  CustomNodeData,
  ConstraintDockNodeData,
  ConstraintDockRow,
  SchemaNodeData,
  JsonSchemaNodeData,
  BaseSchemaColumn,
} from '@/types/graph'
import {
  isConstraintNodeType,
  getConstraintKindByNodeType,
} from '@/services/constraints/validationRegistry'
import {
  addEdges,
  removeEdges,
  removeNodes,
  VueFlowApiNotInitializedError,
} from '@/services/canvas/vueFlowApi'
import {
  computeClearanceShift,
  computeItemsBounds,
  layoutBatchAsGrid,
  type PlacedItem,
  type RectBounds,
} from '@/features/node-layout-organizer/utils/batchPlacement'
import { getDefaultDimension } from '@/features/node-layout-organizer/utils/nodeDimensionHelper'
import { constraintDockNodeId } from './factories/dockFactory'
import { logger } from '@/core/utils/logger'

// ============================================================================
// 聚合阈值（动态计算；产品确认：> 阈值隐藏全部约束卡片）
//
// threshold = clamp( round( max(schemaHeight, viewportHeight × 0.7) / 130 ), 4, 16 )
//   - 130 = 约束卡片高度（对齐 features/node-layout-organizer 的 NODE_DIMENSIONS.CONSTRAINT_HEIGHT；
//     不直接 import 是为避免 store→feature 反向依赖，两处需人工同步）
//   - schemaHeight 走既有尺寸候选链：Vue Flow node.dimensions → data.height → 兜底估算
//   - viewportHeight 取 Vue Flow 容器实测高度；取不到时按 800px 兜底
//   - 下限 4：卡片太少不值得建坞；上限 16：防大屏下卡片重新淹没画布
// ============================================================================

/** 约束卡片高度（flow 坐标 px）——阈值公式分母，语义对齐 NODE_DIMENSIONS.CONSTRAINT_HEIGHT */
export const CONSTRAINT_DOCK_CARD_HEIGHT_PX = 130

/** 阈值公式的视口参与比例：max(schemaHeight, viewport × 0.7) 构成"可视高度预算" */
export const CONSTRAINT_DOCK_VIEWPORT_RATIO = 0.7

/** 视口高度兜底：画布未挂载 / DOM 不可读时按 800px 估算 */
export const CONSTRAINT_DOCK_VIEWPORT_FALLBACK_HEIGHT_PX = 800

/** 阈值下限：少于 4 张卡片不值得聚合（坞的占位成本高于收益） */
export const CONSTRAINT_DOCK_THRESHOLD_MIN = 4

/** 阈值上限：大屏 / 高 schema 下防卡片重新淹没画布 */
export const CONSTRAINT_DOCK_THRESHOLD_MAX = 16

/** Schema 高度兜底（无实测尺寸时；语义对齐 NODE_DIMENSIONS.DEFAULT_HEIGHT） */
export const CONSTRAINT_DOCK_FALLBACK_SCHEMA_HEIGHT = 170

/**
 * 计算单个 Schema 的聚合阈值（纯函数）。
 *
 * @param schemaHeight 宿主 Schema 高度（尺寸候选链解析后的值，px）
 * @param viewportHeight 画布视口高度（px）
 * @returns clamp(round(max(schemaHeight, viewport × 0.7) / 130), 4, 16)
 */
export function computeDockThreshold(schemaHeight: number, viewportHeight: number): number {
  const basis = Math.max(schemaHeight, viewportHeight * CONSTRAINT_DOCK_VIEWPORT_RATIO)
  if (!Number.isFinite(basis) || basis <= 0) return CONSTRAINT_DOCK_THRESHOLD_MIN
  const raw = Math.round(basis / CONSTRAINT_DOCK_CARD_HEIGHT_PX)
  return Math.min(CONSTRAINT_DOCK_THRESHOLD_MAX, Math.max(CONSTRAINT_DOCK_THRESHOLD_MIN, raw))
}

/**
 * 读取 Vue Flow 容器高度（阈值公式的视口项）。
 *
 * 取舍：非响应式惰性读取——每次 syncDocks 取最新值，但纯视口 resize（无画布
 * mutation）不会触发 fingerprint 重算，需等下一次画布变化才按新视口重聚合。
 * 不在 store 上挂 window resize 监听的原因：Pinia 单例 store 无卸载钩子，
 * 监听器生命周期只能靠自律管理（HMR 重复注册风险），而视口漂移对阈值的
 * 影响通常 ≤ 一两张卡片，不值得引入该负担。
 */
function readViewportHeight(): number {
  if (typeof document === 'undefined') return CONSTRAINT_DOCK_VIEWPORT_FALLBACK_HEIGHT_PX
  const pane = document.querySelector('.vue-flow')
  const height = pane?.getBoundingClientRect().height ?? 0
  return height > 0 ? height : CONSTRAINT_DOCK_VIEWPORT_FALLBACK_HEIGHT_PX
}

/** 坞与 Schema 右缘的水平间距（flow 坐标） */
export const CONSTRAINT_DOCK_GAP_X = 60

/** Schema 宽度兜底值（与 useSchemaResizable 默认宽度一致） */
export const CONSTRAINT_DOCK_FALLBACK_SCHEMA_WIDTH = 360

// ============================================================================
// L2 全部展开：栅格布局常量（对齐批量导入约束的视觉惯例，
// 见 importV2ResourceToCanvas 的 IMPORT_GRID_* 常量——每列 6 个、列距 420、行距 60）
// ============================================================================

/** 坞自身渲染宽度（ConstraintDockNode.styles.css 固定 200px），展开栅格 origin 的基准 */
export const CONSTRAINT_DOCK_WIDTH_PX = 200

/** 展开栅格：每列最多卡片数（与导入批次栅格一致） */
export const DOCK_EXPAND_GRID_ROWS_PER_COLUMN = 6

/** 展开栅格：列间距（与导入批次 420 视觉惯例一致） */
export const DOCK_EXPAND_GRID_COLUMN_GAP = 420

/** 展开栅格：同列行间距 */
export const DOCK_EXPAND_GRID_ROW_GAP = 60

/** 展开批次与既有节点保持的最小净空距离（与导入批次一致） */
export const DOCK_EXPAND_CLEARANCE_GAP = 40

// ============================================================================
// 列行 → 坞行展示边（schema-to-dock-display）
//
// 先例：FK 展示边（foreign-key-display 规则 + data.kind='fkDisplay'）。
// 差异点：坞展示边由 dockSync 聚合器全权生命周期管理（建/拆/增删列），
// data.transient=true 使其不进撤销快照、不触发断开清理链、不可手工删除——
// 边完全可由聚合状态确定性重建（edge id 确定性派生），undo/AI/多 Tab 快照
// 中的残留由下一次 syncDocks 幂等收敛。
// ============================================================================

/** 属展示边 data.kind 标识（虚拟锚点 proxy 会透传该 kind，同样按展示边处理） */
export const DOCK_DISPLAY_EDGE_KIND = 'dockDisplay'

/** 坞组件唯一 target handle id（单 handle 汇聚，视觉弱于数据边） */
export const DOCK_DISPLAY_TARGET_HANDLE = 'target-dock'

/** 展示边 id：确定性派生，幂等 ensure 与多 Tab 快照恢复共用 */
export function dockDisplayEdgeId(schemaNodeId: string, columnId: string): string {
  return `dock-edge-${schemaNodeId}-${columnId}`
}

/** 判定一条边是否为坞展示边（含虚拟锚点 proxy 透传 kind 的副本） */
export function isDockDisplayEdge(edge: Edge): boolean {
  return (edge.data as { kind?: string } | undefined)?.kind === DOCK_DISPLAY_EDGE_KIND
}

/** 防抖窗口：拖拽/导入/AI 等连续 mutation 归并为一次同步 */
const SYNC_DEBOUNCE_MS = 300

type DockNodeLevelPatch = Partial<Pick<CustomNode, 'hidden' | 'position'>>

// ============================================================================
// 纯函数：派生与指纹（导出供单测）
// ============================================================================

/** 读取 Vue Flow 实测尺寸（渲染后经 v-model 回写；渲染前缺席） */
function readNodeDimensions(node: CustomNode): { width: number; height: number } | null {
  const dim = (node as CustomNode & { dimensions?: { width: number; height: number } }).dimensions
  if (dim && dim.width > 0 && dim.height > 0) return dim
  return null
}

function isSchemaNodeType(type: string | undefined): boolean {
  return type === 'schema' || type === 'jsonSchema'
}

/** Schema 列 source handle 固定格式：source-right-{columnId} */
function parseColumnIdFromHandle(sourceHandle: string | null | undefined): string | undefined {
  if (!sourceHandle) return undefined
  const prefix = 'source-right-'
  return sourceHandle.startsWith(prefix) ? sourceHandle.slice(prefix.length) : undefined
}

function readSchemaData(node: CustomNode): SchemaNodeData | JsonSchemaNodeData {
  return node.data as SchemaNodeData | JsonSchemaNodeData
}

/** 单个 Schema 的坞派生结果 */
export interface ConstraintDockDerivation {
  schemaNodeId: string
  /** 坞标题展示名 */
  configName: string
  schemaPosition: { x: number; y: number }
  schemaWidth: number
  /** 宿主 Schema 高度（尺寸候选链解析后，阈值公式输入） */
  schemaHeight: number
  /** 该 schema 的动态聚合阈值（clamp(round(max(schemaHeight, viewport×0.7)/130), 4, 16)） */
  threshold: number
  /** 模板折叠等语义下的 schema 隐藏态（坞镜像） */
  schemaHidden: boolean
  /** 按 Schema 列序排列的行快照（表级/悬空约束沉底） */
  rows: ConstraintDockRow[]
  /** 挂靠该 schema 的独立约束节点 id 集合 */
  standaloneIds: string[]
  /** 独立约束卡片数是否超过聚合阈值 */
  shouldAggregate: boolean
}

interface AttachedConstraint {
  node: CustomNode
  columnId?: string
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
 * 派生全部 schema 的坞状态（纯函数）。
 * 行序 = Schema 列序；每列先内嵌（columns[].constraints）后独立；
 * columnId 缺失或不在列集中的约束沉底。
 *
 * @param viewportHeight 视口高度（阈值公式输入；由调用方实测或兜底）
 */
export function deriveConstraintDocks(
  nodes: ReadonlyArray<CustomNode>,
  edges: ReadonlyArray<Edge>,
  viewportHeight: number
): Map<string, ConstraintDockDerivation> {
  const attachments = buildConstraintAttachments(nodes, edges)
  const result = new Map<string, ConstraintDockDerivation>()

  for (const node of nodes) {
    if (!isSchemaNodeType(node.type)) continue

    const data = readSchemaData(node)
    const columns: BaseSchemaColumn[] = data.columns || []
    const attached = attachments.get(node.id) || []

    const rows: ConstraintDockRow[] = []
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
      CONSTRAINT_DOCK_FALLBACK_SCHEMA_WIDTH
    // 高度候选链与宽度同构：实测 dimensions → 持久化 data.height → 兜底估算
    const schemaHeight =
      (dim?.height ?? 0) ||
      (typeof data.height === 'number' && data.height > 0 ? data.height : 0) ||
      CONSTRAINT_DOCK_FALLBACK_SCHEMA_HEIGHT
    const threshold = computeDockThreshold(schemaHeight, viewportHeight)

    result.set(node.id, {
      schemaNodeId: node.id,
      configName: data.configName || data.tableName || node.id,
      schemaPosition: { x: node.position.x, y: node.position.y },
      schemaWidth,
      schemaHeight,
      threshold,
      schemaHidden: node.hidden === true,
      rows,
      standaloneIds: attached.map((a) => a.node.id),
      shouldAggregate: attached.length > threshold,
    })
  }

  return result
}

/**
 * 计算坞同步指纹（纯函数）：任何影响坞存在性/内容/位置的状态变化都改变返回值。
 * 刻意排除：约束卡片 hidden（防聚合回环）、validationStatus（组件直读）、坞自身、
 * 坞展示边（kind=dockDisplay，含其虚拟锚点 proxy——由 syncDocks 自身创建/移除，
 * 拼入指纹会在"建边 → 状态变化 → 再同步"间形成回环）。
 */
export function computeConstraintDockFingerprint(
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
      fp += `S|${node.id}|${Math.round(node.position.x)},${Math.round(node.position.y)}|${
        dim?.width ?? data.width ?? 0
      }x${dim?.height ?? data.height ?? 0}|${node.hidden ? 1 : 0}|${colSig}\n`
    } else if (isConstraintNodeType(node.type)) {
      const data = (node.data || {}) as {
        sourceRef?: { nodeId?: string; columnId?: string }
        configName?: string
        constraintName?: string
      }
      fp += `C|${node.id}|${node.type}|${data.sourceRef?.nodeId ?? ''}|${
        data.sourceRef?.columnId ?? ''
      }|${data.configName ?? data.constraintName ?? ''}\n`
    }
  }
  const constraintIdSet = new Set(
    nodes.filter((n) => isConstraintNodeType(n.type)).map((n) => n.id)
  )
  const schemaIdSet = new Set(nodes.filter((n) => isSchemaNodeType(n.type)).map((n) => n.id))
  for (const edge of edges) {
    // 坞展示边不参与指纹（见函数头注释）
    if (isDockDisplayEdge(edge)) continue
    // 只拼 schema 相关边：约束入边（拓扑挂靠）与 schema 出入边（重排/断连影响坞内容）
    if (
      !constraintIdSet.has(edge.target) &&
      !schemaIdSet.has(edge.source) &&
      !schemaIdSet.has(edge.target)
    ) {
      continue
    }
    fp += `E|${edge.id}|${edge.source}|${edge.target}|${edge.sourceHandle ?? ''}\n`
  }
  return fp
}

// ============================================================================
// 模块工厂：watcher + 同步执行
// ============================================================================

/** 展示边目标列集合推导：rows 中出现且仍存在于 Schema 列集的 columnId（按 Schema 列序） */
export function collectDockEdgeColumns(
  columns: ReadonlyArray<BaseSchemaColumn>,
  rows: ReadonlyArray<ConstraintDockRow>
): string[] {
  const rowColumnIds = new Set(
    rows.map((r) => r.columnId).filter((id): id is string => typeof id === 'string')
  )
  return columns.map((c) => c.id).filter((id) => rowColumnIds.has(id))
}

/** L2 展开放置的输入卡片（id + 参与栅格计算的预估尺寸） */
export interface DockExpandCard {
  id: string
  width: number
  height: number
}

/**
 * L2 全部展开的纯布局计算（导出供单测）：
 * layoutBatchAsGrid 栅格（每列 6、列距 420、行距 60，同导入批次）落在坞右侧，
 * 经 computeClearanceShift 整体平移避让 obstacles（既有节点包围盒）。
 *
 * @returns 卡片 id → 画布落点
 */
export function computeDockExpandPlacement(input: {
  cards: ReadonlyArray<DockExpandCard>
  dockPosition: { x: number; y: number }
  dockWidth: number
  obstacles: ReadonlyArray<RectBounds>
}): Map<string, { x: number; y: number }> {
  if (input.cards.length === 0) return new Map()
  const items = input.cards.map((c) => ({ id: c.id, width: c.width, height: c.height }))
  const origin = {
    x: input.dockPosition.x + input.dockWidth + CONSTRAINT_DOCK_GAP_X,
    y: input.dockPosition.y,
  }
  const positions = layoutBatchAsGrid(items, origin, {
    rowsPerColumn: DOCK_EXPAND_GRID_ROWS_PER_COLUMN,
    columnGap: DOCK_EXPAND_GRID_COLUMN_GAP,
    rowGap: DOCK_EXPAND_GRID_ROW_GAP,
  })

  const placedItems: PlacedItem[] = []
  for (const card of input.cards) {
    const pos = positions.get(card.id)
    if (pos) placedItems.push({ position: pos, width: card.width, height: card.height })
  }
  const block = computeItemsBounds(placedItems)
  if (block) {
    const { dx, dy } = computeClearanceShift(block, input.obstacles, DOCK_EXPAND_CLEARANCE_GAP)
    if (dx !== 0 || dy !== 0) {
      for (const [id, pos] of positions) {
        positions.set(id, { x: pos.x + dx, y: pos.y + dy })
      }
    }
  }
  return positions
}

export function createDockSyncModule(params: {
  nodes: Ref<CustomNode[]>
  edges: Ref<Edge[]>
  updateNodeData: (nodeId: string, newData: Partial<CustomNodeData & DockNodeLevelPatch>) => void
  ensureConstraintDockForSchema: (input: {
    schemaNodeId: string
    configName: string
    rows: ConstraintDockRow[]
    position: { x: number; y: number }
  }) => Promise<string>
  /** 多选集合（L1 揭示的卡片以选中态豁免再聚合） */
  selectedNodeIds: Ref<string[]>
}) {
  const { nodes, edges, updateNodeData, ensureConstraintDockForSchema, selectedNodeIds } = params

  const fingerprint = computed(() => computeConstraintDockFingerprint(nodes.value, edges.value))

  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  watch(
    fingerprint,
    () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        syncDocks().catch((error) => {
          logger.warn('[dockSync] 约束坞同步失败：', error)
        })
      }, SYNC_DEBOUNCE_MS)
    },
    { flush: 'post' }
  )

  function removeDockNode(dockId: string): void {
    try {
      removeNodes(dockId)
    } catch (error) {
      if (error instanceof VueFlowApiNotInitializedError) {
        // 无头上下文兜底：节点全量数组替换；关联展示边由
        // pruneOrphanDockDisplayEdges 统一清理（transient 边无清理链依赖）
        nodes.value = nodes.value.filter((n) => n.id !== dockId)
        return
      }
      throw error
    }
  }

  /** 展示边增量创建（Vue Flow 纪律：增量走 addEdges；无头上下文数组替换兜底） */
  function addDockEdgesSafely(newEdges: Edge[]): void {
    if (newEdges.length === 0) return
    try {
      addEdges(newEdges)
    } catch (error) {
      if (error instanceof VueFlowApiNotInitializedError) {
        edges.value = [...edges.value, ...newEdges]
        return
      }
      throw error
    }
  }

  /** 展示边增量移除（transient 边无清理链依赖，全量替换兜底安全） */
  function removeDockEdgesSafely(edgeIds: string[]): void {
    if (edgeIds.length === 0) return
    try {
      removeEdges(edgeIds)
    } catch (error) {
      if (error instanceof VueFlowApiNotInitializedError) {
        const ids = new Set(edgeIds)
        edges.value = edges.value.filter((e) => !ids.has(e.id))
        return
      }
      throw error
    }
  }

  /** 读取节点参与避让计算的包围盒（实测尺寸优先，类型默认值兜底） */
  function nodeBounds(node: CustomNode): RectBounds {
    const dim = readNodeDimensions(node) ?? getDefaultDimension(node.type ?? '')
    return {
      minX: node.position.x,
      minY: node.position.y,
      maxX: node.position.x + dim.width,
      maxY: node.position.y + dim.height,
    }
  }

  /**
   * 展示边生命周期同步（幂等）：desired = 有约束且仍存在的 Schema 列集合；
   * 多余的移除（列约束清零 / 列删除），缺失的按确定性 id 创建。
   * 虚拟锚点 proxy 的 sourceHandle 非列格式，其生死由 useVirtualAnchorEdges
   * 按语义边签名收回，此处不处理。
   */
  function syncDockDisplayEdges(
    dock: CustomNode,
    schemaNode: CustomNode,
    rows: ReadonlyArray<ConstraintDockRow>
  ): void {
    const schemaData = readSchemaData(schemaNode)
    const desired = new Set(collectDockEdgeColumns(schemaData.columns || [], rows))

    const staleIds: string[] = []
    for (const edge of edges.value) {
      if (!isDockDisplayEdge(edge) || edge.target !== dock.id) continue
      const columnId = parseColumnIdFromHandle(edge.sourceHandle)
      if (columnId && !desired.has(columnId)) staleIds.push(edge.id)
    }
    removeDockEdgesSafely(staleIds)

    const existingColumns = new Set(
      edges.value
        .filter((e) => isDockDisplayEdge(e) && e.target === dock.id)
        .map((e) => parseColumnIdFromHandle(e.sourceHandle))
        .filter((c): c is string => !!c)
    )
    const toAdd: Edge[] = []
    for (const columnId of desired) {
      if (existingColumns.has(columnId)) continue
      toAdd.push({
        id: dockDisplayEdgeId(schemaNode.id, columnId),
        source: schemaNode.id,
        target: dock.id,
        sourceHandle: `source-right-${columnId}`,
        targetHandle: DOCK_DISPLAY_TARGET_HANDLE,
        type: 'smoothstep',
        animated: false,
        class: 'dock-display-edge',
        // 视觉明显弱于数据边：细虚线 + 低透明度（FK 展示边同源的弱化手法）
        style: {
          stroke: 'var(--edge-fk-display)',
          strokeWidth: 1.1,
          strokeDasharray: '2 6',
          opacity: 0.55,
        },
        data: {
          kind: DOCK_DISPLAY_EDGE_KIND,
          transient: true,
          schemaNodeId: schemaNode.id,
          columnId,
        },
      })
    }
    addDockEdgesSafely(toAdd)
  }

  /** 清理目标坞已不存在的展示边（拆坞后 / 快照恢复出的孤儿边） */
  function pruneOrphanDockDisplayEdges(): void {
    const liveDocks = new Set(
      nodes.value.filter((n) => n.type === 'constraintDock').map((n) => n.id)
    )
    const orphanIds = edges.value
      .filter((e) => isDockDisplayEdge(e) && !liveDocks.has(e.target))
      .map((e) => e.id)
    removeDockEdgesSafely(orphanIds)
  }

  /** 恢复被聚合隐藏的独立约束卡片（拆坞 / schema 消失时） */
  function restoreRows(rows: ReadonlyArray<ConstraintDockRow>): void {
    for (const row of rows) {
      if (row.embedded) continue
      const target = nodes.value.find((n) => n.id === row.constraintId)
      if (target?.hidden === true) {
        updateNodeData(row.constraintId, { hidden: false })
      }
    }
  }

  /**
   * 聚合隐藏维护：隐藏"当前可见且未被选中"的独立约束卡片。
   * 选中态是 L1 揭示的信号（点击徽标 → setSelection），跳过避免夺走用户焦点；
   * 新加入的未选中卡片（AI/导入/手动连线）自然纳入聚合。
   */
  function hideAggregatedCards(standaloneIds: ReadonlyArray<string>): void {
    const selected = new Set(selectedNodeIds.value)
    for (const id of standaloneIds) {
      const target = nodes.value.find((n) => n.id === id)
      if (target && target.hidden !== true && !selected.has(id)) {
        updateNodeData(id, { hidden: true })
      }
    }
  }

  /**
   * L2 全部展开：该坞聚合的独立约束卡片全部 un-hide，栅格布局落在坞右侧
   * （每列 6、列距 420、行距 60，同导入批次），经净空避让既有节点。
   * 坞保持显示（徽标仍是导航入口），expandedAll 仅存会话。
   */
  function expandDockAll(dockId: string): void {
    const dock = nodes.value.find((n) => n.id === dockId && n.type === 'constraintDock')
    if (!dock) return
    const dockData = dock.data as ConstraintDockNodeData
    if (dockData.expandedAll) return

    const cards: DockExpandCard[] = []
    for (const row of dockData.rows) {
      if (row.embedded) continue
      const node = nodes.value.find((n) => n.id === row.constraintId)
      if (!node) continue
      const dim = readNodeDimensions(node) ?? getDefaultDimension(node.type ?? '')
      cards.push({ id: node.id, width: dim.width, height: dim.height })
    }

    const placedIds = new Set(cards.map((c) => c.id))
    const positions = computeDockExpandPlacement({
      cards,
      dockPosition: dock.position,
      dockWidth: readNodeDimensions(dock)?.width ?? CONSTRAINT_DOCK_WIDTH_PX,
      obstacles: nodes.value.filter((n) => !placedIds.has(n.id)).map(nodeBounds),
    })
    for (const [id, pos] of positions) {
      updateNodeData(id, { hidden: false, position: pos })
    }
    updateNodeData(dockId, { expandedAll: true })
  }

  /** L2 收回：重新聚合隐藏（跳过当前选中的，语义同 hideAggregatedCards） */
  function collapseDockAll(dockId: string): void {
    const dock = nodes.value.find((n) => n.id === dockId && n.type === 'constraintDock')
    if (!dock) return
    const dockData = dock.data as ConstraintDockNodeData
    if (!dockData.expandedAll) return
    updateNodeData(dockId, { expandedAll: false })
    hideAggregatedCards(dockData.rows.filter((r) => !r.embedded).map((r) => r.constraintId))
  }

  /**
   * 展开态下新进入坞的独立约束卡片：不隐藏，落栅格下一空位
   * （按前一批次快照推算列/行游标；不追求完美布局，允许后续 syncDocks 收敛）。
   */
  function placeNewCardsInExpandedDock(
    dock: CustomNode,
    prevRows: ReadonlyArray<ConstraintDockRow>,
    standaloneIds: ReadonlyArray<string>
  ): void {
    const prevStandalone = prevRows.filter((r) => !r.embedded)
    const prevIds = new Set(prevStandalone.map((r) => r.constraintId))

    const dockWidth = readNodeDimensions(dock)?.width ?? CONSTRAINT_DOCK_WIDTH_PX
    const baseX = dock.position.x + dockWidth + CONSTRAINT_DOCK_GAP_X
    // 栅格下一空位：列游标 = 既有独立卡数整除每列容量，行游标 = 余数
    let slot = prevStandalone.length
    for (const id of standaloneIds) {
      if (prevIds.has(id)) continue
      const node = nodes.value.find((n) => n.id === id)
      if (!node) continue
      const dim = readNodeDimensions(node) ?? getDefaultDimension(node.type ?? '')
      const col = Math.floor(slot / DOCK_EXPAND_GRID_ROWS_PER_COLUMN)
      const row = slot % DOCK_EXPAND_GRID_ROWS_PER_COLUMN
      updateNodeData(id, {
        hidden: false,
        position: {
          x: baseX + col * DOCK_EXPAND_GRID_COLUMN_GAP,
          y: dock.position.y + row * (dim.height + DOCK_EXPAND_GRID_ROW_GAP),
        },
      })
      slot++
    }
  }

  async function syncDocks(): Promise<void> {
    // 视口项惰性读取（取舍见 readViewportHeight 注释）：无画布/未渲染时走 800px 兜底
    const viewportHeight = readViewportHeight()
    const derivations = deriveConstraintDocks(nodes.value, edges.value, viewportHeight)

    // Pass 1：拆坞 —— schema 消失或约束数回落到阈值内
    const dockNodes = nodes.value.filter((n) => n.type === 'constraintDock')
    for (const dock of dockNodes) {
      const dockData = dock.data as ConstraintDockNodeData
      const derivation = derivations.get(dockData.schemaNodeId)
      if (derivation && derivation.shouldAggregate) continue
      restoreRows(dockData.rows)
      removeDockNode(dock.id)
    }
    pruneOrphanDockDisplayEdges()

    // Pass 2：建坞 / 增量更新
    for (const derivation of derivations.values()) {
      if (!derivation.shouldAggregate) continue
      const dockId = constraintDockNodeId(derivation.schemaNodeId)
      const position = {
        x: derivation.schemaPosition.x + derivation.schemaWidth + CONSTRAINT_DOCK_GAP_X,
        y: derivation.schemaPosition.y,
      }
      const existing = nodes.value.find((n) => n.id === dockId && n.type === 'constraintDock')
      if (!existing) {
        await ensureConstraintDockForSchema({
          schemaNodeId: derivation.schemaNodeId,
          configName: derivation.configName,
          rows: derivation.rows,
          position,
        })
        hideAggregatedCards(derivation.standaloneIds)
        const schemaNode = nodes.value.find((n) => n.id === derivation.schemaNodeId)
        const created = nodes.value.find((n) => n.id === dockId && n.type === 'constraintDock')
        // 工厂已 await nextTick（坞渲染后才有 handleBounds），此时建边时序安全
        if (schemaNode && created) syncDockDisplayEdges(created, schemaNode, derivation.rows)
        continue
      }

      const prevDockData = existing.data as ConstraintDockNodeData
      // updateNodeData 为原地合并语义（Object.assign 到 node.data），
      // prev 快照必须在 patch 前捕获引用，否则读到新 rows 导致新卡片判定失效
      const prevRows = prevDockData.rows
      const wasExpandedAll = prevDockData.expandedAll === true
      const patch: Partial<CustomNodeData & DockNodeLevelPatch> = {
        rows: derivation.rows,
        configName: derivation.configName,
      }
      if ((existing.hidden === true) !== derivation.schemaHidden) {
        patch.hidden = derivation.schemaHidden
      }
      if (
        Math.abs(existing.position.x - position.x) > 0.5 ||
        Math.abs(existing.position.y - position.y) > 0.5
      ) {
        patch.position = position
      }
      updateNodeData(dockId, patch)

      if (wasExpandedAll) {
        // L2 展开态：新卡片保持展开语义（不隐藏、落栅格下一空位）
        placeNewCardsInExpandedDock(existing, prevRows, derivation.standaloneIds)
      } else {
        hideAggregatedCards(derivation.standaloneIds)
      }

      const schemaNode = nodes.value.find((n) => n.id === derivation.schemaNodeId)
      if (schemaNode) syncDockDisplayEdges(existing, schemaNode, derivation.rows)
    }
  }

  return {
    /** 立即同步（跳过防抖；测试与确定性场景用） */
    syncDocks,
    /** L2 全部展开（坞标题栏按钮入口） */
    expandDockAll,
    /** L2 收回（坞标题栏按钮入口） */
    collapseDockAll,
  }
}
