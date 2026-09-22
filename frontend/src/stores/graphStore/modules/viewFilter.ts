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
 * @fileoverview 画布视图模式 + 节点类型筛选 —— 只管理"自己隐藏"的节点的视图层模块
 *
 * 三个可叠加的视图维度（ conjunction 语义，任一维度说隐藏即隐藏）：
 * - 全景 / 聚焦（viewMode）：聚焦 = 锚点节点 + 直接相连节点构成闭包，
 *   闭包外业务节点隐藏。锚点 = 进入聚焦模式时的选中节点；聚焦期间
 *   选中 Schema/jsonSchema 会实时换锚（P3 设计以 Schema 为聚焦主体，
 *   非 Schema 点击不换锚，避免逐卡片点击时视图跳动）。
 * - 仅异常（errorsOnly）：validationStatus ∈ {pass, idle, undefined} 的
 *   约束卡片隐藏，error/missing（及未来可能的 warning 等新状态）显示；
 *   非约束节点不受影响。
 * - 节点类型分组显隐（hiddenGroups）：按 schema/source/transform/
 *   constraint/regex/other 六组勾选控制。
 *
 * 与约束坞（dockSync）的 ownership 纪律——本模块最大的耦合点：
 * - hidden 写入一律走注入的 updateNodeData（state.ts 路由为 node 级 patch）；
 * - 只隐藏"当前可见"的节点并记入 mine 集合；已被坞聚合隐藏 / 模板折叠
 *   隐藏的节点不动、不入 mine（不抢坞的所有权）；
 * - 恢复时只恢复 mine 中的节点，且若该节点此刻挂靠在某个未展开的坞的
 *   rows 里（聚合态），所有权让渡给坞——不揭示，仅移出 mine
 *   （拆坞时 dockSync 的 restoreRows 自会揭示）；
 * - 聚焦/仅异常/类型筛选均不隐藏 constraintDock（状态总览与导航入口）
 *   与 projectRoot（项目锚点，Ctrl+H 目标）。
 *
 * 选中节点豁免（镜像 dockSync hideAggregatedCards 的语义）：watcher 驱动的
 * 重应用跳过当前选中的节点——坞徽标 L1 揭示（选中态）不被仅异常模式立即
 * 吞回。用户主动切换视图维度时则按选择模型一致性纪律先清空将被隐藏的选中。
 *
 * 持久化：localStorage 单 key 按项目配置路径分桶（刻意偏离原"存
 * project.view.json"计划——视图偏好是客户端本地状态，不进共享 V2 类型，
 * 也不制造多人/多端同步噪音）。聚焦锚点与"我隐藏的节点 id"一并持久化
 * （节点 id 跨重载稳定；工作区快照会把 hidden 标志存进 tab 快照，重载
 * 恢复后需回填所有权，否则关闭筛选时留下无主 hidden 节点）。
 * 水合期间锚点未出现时先不过滤（anchorSeen 门闩防误退全景）；所有权册
 * 同理——画布尚无业务节点时不按「未找到」修剪 mine（防回填所有权在
 * projectRoot-only 中间态被清空并覆写桶，见 applyViewFilter 门闩）。
 *
 * 已知边界：undo 恢复"视图筛选隐藏期"的快照后立即关闭筛选，可能留下
 * 无主 hidden 节点（全量数组替换冲掉了 mine 所有权）——既有逃生口是
 * Ctrl+H 聚焦项目根（恢复全部隐藏节点，含坞聚合卡，属既有语义）。
 */

import { computed, ref, watch, type Ref } from 'vue'
import type { Edge } from '@vue-flow/core'
import type { CustomNode, CustomNodeData, ConstraintDockNodeData } from '@/types/graph'
import { isConstraintNodeType } from '@/services/constraints/constraintMeta'
import { logger } from '@/core/utils/logger'

// ============================================================================
// 节点类型分组（纯数据，导出供组件与测试消费）
// ============================================================================

/** 视图筛选的节点大类（分组顺序即 UI 勾选列表顺序） */
export const NODE_FILTER_GROUPS = [
  'schema',
  'source',
  'transform',
  'constraint',
  'regex',
  'other',
] as const

export type NodeFilterGroup = (typeof NODE_FILTER_GROUPS)[number]

/** 类型 → 分组映射（约束类型经 isConstraintNodeType 单独判定） */
const NODE_TYPE_GROUP_MAP: Record<string, NodeFilterGroup> = {
  schema: 'schema',
  jsonSchema: 'schema',
  sourcePreview: 'source',
  jsonSourcePreview: 'source',
  manualData: 'source',
  transform: 'transform',
  transformOutput: 'transform',
  regex: 'regex',
  regexExtract: 'regex',
  pattern: 'other',
  patternToolbox: 'other',
  constraintDashboard: 'other',
  templateInstance: 'other',
}

/**
 * 节点类型 → 筛选分组。
 *
 * @returns null = 永不受筛（projectRoot 项目锚点 / constraintDock 状态总览）；
 *          未知未来类型归入 'other'
 */
export function getNodeFilterGroup(type: string | undefined): NodeFilterGroup | null {
  if (type === 'projectRoot' || type === 'constraintDock') return null
  if (isConstraintNodeType(type)) return 'constraint'
  return NODE_TYPE_GROUP_MAP[type ?? ''] ?? 'other'
}

function isSchemaNodeType(type: string | undefined): boolean {
  return type === 'schema' || type === 'jsonSchema'
}

/** 聚焦锚点的合法类型：任意业务节点（projectRoot / constraintDock 不可作锚） */
function isFocusableType(type: string | undefined): boolean {
  return !!type && type !== 'projectRoot' && type !== 'constraintDock'
}

// ============================================================================
// 纯函数：闭包 / 指纹 / 期望隐藏集（导出供单测）
// ============================================================================

/**
 * 计算聚焦闭包（纯函数）。
 *
 * P3 设计以 Schema 为聚焦主体；实现推广到任意业务锚点。闭包构成：
 * 1. 锚点自身；
 * 2. 与锚点直接相连的节点（边任一端命中）——约束、数据源、上下游；
 * 3. 锚点是 Schema 时：data.sourceRef.nodeId 指向它的独立约束
 *    （镜像 dockSync buildConstraintAttachments 的"并集挂靠"判定，
 *    覆盖无边挂靠场景）；
 * 4. 转换伴生对：闭包内节点的 outputNodeIds / parentTransformId /
 *    inputFromNode 引用（transform ↔ transformOutput 的视觉伴生关系
 *    不一定有边，聚焦 transform 时不孤立其输出卡）。
 *
 * 列级聚焦取舍：全局无"选中列"状态（SchemaNodeColumnRow 仅组件内局部
 * 交互态），故聚焦粒度为 Schema 级——该列的约束进一步筛选不可行，
 * 代码按 Schema 级实现（若未来引入列级选中状态，可在闭包步骤 3 处
 * 按 columnId 过滤收紧）。
 *
 * @returns null = 锚点不存在/不可聚焦 → 聚焦维度不过滤
 */
export function computeFocusClosure(
  anchorId: string | null,
  nodes: ReadonlyArray<CustomNode>,
  edges: ReadonlyArray<Edge>
): Set<string> | null {
  if (!anchorId) return null
  const anchor = nodes.find((n) => n.id === anchorId)
  if (!anchor || !isFocusableType(anchor.type)) return null

  const closure = new Set<string>([anchorId])

  for (const edge of edges) {
    if (edge.source === anchorId) closure.add(edge.target)
    else if (edge.target === anchorId) closure.add(edge.source)
  }

  if (isSchemaNodeType(anchor.type)) {
    for (const node of nodes) {
      if (!isConstraintNodeType(node.type)) continue
      const ref = (node.data || {}) as { sourceRef?: { nodeId?: string } }
      if (ref.sourceRef?.nodeId === anchorId) closure.add(node.id)
    }
  }

  const exists = (id: string) => nodes.some((n) => n.id === id)
  for (const node of nodes) {
    if (!closure.has(node.id)) continue
    const data = (node.data || {}) as {
      outputNodeIds?: string[]
      parentTransformId?: string
      inputFromNode?: string
    }
    for (const outId of data.outputNodeIds ?? []) {
      if (exists(outId)) closure.add(outId)
    }
    if (data.parentTransformId && exists(data.parentTransformId)) {
      closure.add(data.parentTransformId)
    }
    if (data.inputFromNode && exists(data.inputFromNode)) closure.add(data.inputFromNode)
  }

  return closure
}

/**
 * 仅异常维度的单节点判定（纯函数）。
 *
 * 隐藏 pass / idle / undefined（从未校验视同 idle）；error / missing 显示。
 * 当前类型联合无 'warning'——若未来加入则天然显示（不在隐藏集合内）。
 */
export function shouldHideByErrorsOnly(node: CustomNode): boolean {
  if (!isConstraintNodeType(node.type)) return false
  const status = (node.data || {}) as { validationStatus?: string }
  const s = status.validationStatus
  return s === 'pass' || s === 'idle' || s === undefined
}

/** 视图筛选的活跃输入（computeViewFilterHiddenIds 的参数快照） */
export interface ViewFilterStateSnapshot {
  viewMode: 'panorama' | 'focus'
  focusAnchorId: string | null
  errorsOnly: boolean
  hiddenGroups: ReadonlySet<NodeFilterGroup>
}

/**
 * 计算期望隐藏的节点 id 集合（纯函数，三个维度的 conjunction）。
 *
 * 永不受筛：projectRoot、constraintDock。分组被隐藏时闭包内节点同样隐藏
 * （维度叠加为交集语义，用户显式取消勾选分组优先于聚焦闭包保显）。
 */
export function computeViewFilterHiddenIds(
  nodes: ReadonlyArray<CustomNode>,
  edges: ReadonlyArray<Edge>,
  state: ViewFilterStateSnapshot
): Set<string> {
  const closure =
    state.viewMode === 'focus' ? computeFocusClosure(state.focusAnchorId, nodes, edges) : null
  const hidden = new Set<string>()

  for (const node of nodes) {
    const group = getNodeFilterGroup(node.type)
    if (group === null) continue
    let shouldHide = false
    if (closure && !closure.has(node.id)) shouldHide = true
    if (!shouldHide && state.hiddenGroups.has(group)) shouldHide = true
    if (!shouldHide && state.errorsOnly && shouldHideByErrorsOnly(node)) shouldHide = true
    if (shouldHide) hidden.add(node.id)
  }
  return hidden
}

/**
 * 计算视图筛选重应用指纹（纯函数）。
 *
 * 拼入：节点 id/type/约束校验状态（校验后重收敛"仅异常"）、边拓扑
 * （聚焦闭包随连线变化）、当前隐藏节点签名（Ctrl+H 全量揭示 / 坞聚合
 * 隐藏等外部 hidden 变化后自愈重收敛）。自写 hidden 会改变签名触发
 * 再应用，但重应用幂等（无 delta 即无写入），一轮收敛。
 */
export function computeViewFilterFingerprint(
  nodes: ReadonlyArray<CustomNode>,
  edges: ReadonlyArray<Edge>
): string {
  let fp = ''
  const hiddenIds: string[] = []
  for (const node of nodes) {
    const status = isConstraintNodeType(node.type)
      ? (((node.data || {}) as { validationStatus?: string }).validationStatus ?? '')
      : ''
    fp += `N|${node.id}|${node.type ?? ''}|${status}\n`
    if (node.hidden === true) hiddenIds.push(node.id)
  }
  for (const edge of edges) {
    fp += `E|${edge.id}|${edge.source}|${edge.target}\n`
  }
  fp += `H|${hiddenIds.sort().join(',')}\n`
  return fp
}

/**
 * 判定节点此刻是否被某个聚合态的坞收编（纯函数）。
 *
 * 坞存在（> 阈值才会建坞）且未 L2 全展开 → rows 中的独立约束卡片
 * 处于聚合隐藏语义下，可见性归坞所有。
 */
export function isDockAggregatedNode(nodeId: string, nodes: ReadonlyArray<CustomNode>): boolean {
  for (const node of nodes) {
    if (node.type !== 'constraintDock') continue
    const data = (node.data || {}) as ConstraintDockNodeData
    if (data.expandedAll === true) continue
    if (
      Array.isArray(data.rows) &&
      data.rows.some((r) => !r.embedded && r.constraintId === nodeId)
    ) {
      return true
    }
  }
  return false
}

// ============================================================================
// localStorage 持久化（单 key 按项目配置路径分桶）
// ============================================================================

/** 命名对齐 inspectionStore 的 `precis.<域>.<内容>.v1` 惯例 */
export const VIEW_FILTER_STORAGE_KEY = 'precis.canvas.viewFilter.v1'

/** 持久化载荷（聚焦锚点与我隐藏的节点 id 一并持久化，跨重载稳定） */
export interface PersistedViewFilterState {
  viewMode: 'panorama' | 'focus'
  focusAnchorId: string | null
  errorsOnly: boolean
  hiddenGroups: NodeFilterGroup[]
  /**
   * 我隐藏的节点 id（所有权记忆）。工作区快照会把 hidden 标志一起保存，
   * 重载恢复后若不回填所有权，关闭筛选时这些节点会成为无主 hidden。
   */
  hiddenIds: string[]
}

const VALID_MODES = new Set(['panorama', 'focus'])

/** 校验单个项目桶的持久化值（容错：格式异常返回 null，不影响主流程） */
export function parsePersistedViewFilter(value: unknown): PersistedViewFilterState | null {
  if (!value || typeof value !== 'object') return null
  const state = value as Record<string, unknown>
  if (!VALID_MODES.has(String(state.viewMode))) return null
  const focusAnchorId = typeof state.focusAnchorId === 'string' ? state.focusAnchorId : null
  const errorsOnly = state.errorsOnly === true
  const hiddenGroups = Array.isArray(state.hiddenGroups)
    ? state.hiddenGroups.filter(
        (g): g is NodeFilterGroup =>
          typeof g === 'string' && (NODE_FILTER_GROUPS as readonly string[]).includes(g)
      )
    : []
  const hiddenIds = Array.isArray(state.hiddenIds)
    ? state.hiddenIds.filter((id): id is string => typeof id === 'string')
    : []
  return {
    viewMode: state.viewMode as 'panorama' | 'focus',
    focusAnchorId,
    errorsOnly,
    hiddenGroups,
    hiddenIds,
  }
}

/** 读取指定项目的持久化视图筛选（无桶/格式异常 → null） */
export function loadPersistedViewFilter(configPath: string): PersistedViewFilterState | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(VIEW_FILTER_STORAGE_KEY)
    if (!raw) return null
    const buckets = JSON.parse(raw) as Record<string, unknown>
    if (!buckets || typeof buckets !== 'object') return null
    return parsePersistedViewFilter(buckets[configPath])
  } catch (e) {
    logger.warn('[viewFilter] 读取持久化视图筛选失败:', e)
    return null
  }
}

/** 写入指定项目的视图筛选（合并保留其他项目桶；写失败仅告警不抛错） */
export function persistViewFilter(configPath: string, state: PersistedViewFilterState): void {
  if (typeof localStorage === 'undefined') return
  try {
    const raw = localStorage.getItem(VIEW_FILTER_STORAGE_KEY)
    const buckets = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
    if (!buckets || typeof buckets !== 'object' || Array.isArray(buckets)) return
    buckets[configPath] = state
    localStorage.setItem(VIEW_FILTER_STORAGE_KEY, JSON.stringify(buckets))
  } catch (e) {
    logger.warn('[viewFilter] 持久化视图筛选失败:', e)
  }
}

// ============================================================================
// 模块工厂
// ============================================================================

/** 防抖窗口：校验回写 / 导入 / 连线等连续 mutation 归并为一次重应用 */
const REAPPLY_DEBOUNCE_MS = 300

export function createViewFilterModule(params: {
  nodes: Ref<CustomNode[]>
  edges: Ref<Edge[]>
  selectedNodeId: Ref<string | null>
  selectedNodeIds: Ref<string[]>
  clearSelection: () => void
  updateNodeData: (nodeId: string, newData: Partial<CustomNodeData & { hidden?: boolean }>) => void
  getEffectiveProjectConfigPath: () => string | undefined
}) {
  const {
    nodes,
    edges,
    selectedNodeId,
    selectedNodeIds,
    clearSelection,
    updateNodeData,
    getEffectiveProjectConfigPath,
  } = params

  /** 视图模式：panorama 全景（默认） / focus 聚焦 */
  const viewMode = ref<'panorama' | 'focus'>('panorama')
  /** 聚焦锚点（进入聚焦模式时的选中节点；持久化跨重载） */
  const focusAnchorId = ref<string | null>(null)
  /** 仅异常开关（与聚焦可叠加） */
  const errorsOnly = ref(false)
  /** 被隐藏的节点分组（勾选列表状态；不可变替换保响应） */
  const hiddenGroups = ref(new Set<NodeFilterGroup>())

  /**
   * 我隐藏的节点 id 集合（所有权边界）。
   * 只收录"隐藏时节点尚可见"的 id；已被坞/模板隐藏的不入册，
   * 恢复时也只恢复册内且当前仍隐藏的节点。
   */
  const mine = new Set<string>()
  /**
   * 锚点出现门闩：水合期间锚点节点尚未落画布时不误判"锚点被删"
   * 退出全景；见过一次后消失才视为删除。
   */
  let anchorSeen = false

  function snapshotState(): ViewFilterStateSnapshot {
    return {
      viewMode: viewMode.value,
      focusAnchorId: focusAnchorId.value,
      errorsOnly: errorsOnly.value,
      hiddenGroups: hiddenGroups.value,
    }
  }

  function persist(): void {
    const configPath = getEffectiveProjectConfigPath()
    if (!configPath) return // 项目路径未知（未加载项目）：仅会话态，不落盘
    persistViewFilter(configPath, {
      viewMode: viewMode.value,
      focusAnchorId: focusAnchorId.value,
      errorsOnly: errorsOnly.value,
      hiddenGroups: [...hiddenGroups.value],
      hiddenIds: [...mine],
    })
  }

  function loadBucket(configPath: string | undefined): void {
    if (!configPath) {
      viewMode.value = 'panorama'
      focusAnchorId.value = null
      errorsOnly.value = false
      hiddenGroups.value = new Set()
      mine.clear()
      anchorSeen = false
      return
    }
    const restored = loadPersistedViewFilter(configPath)
    viewMode.value = restored?.viewMode ?? 'panorama'
    focusAnchorId.value = restored?.focusAnchorId ?? null
    errorsOnly.value = restored?.errorsOnly ?? false
    hiddenGroups.value = new Set(restored?.hiddenGroups ?? [])
    // 回填所有权：工作区快照恢复出的 hidden 节点重新归我名下，
    // 关闭筛选时才能被恢复（不留无主 hidden）
    mine.clear()
    for (const id of restored?.hiddenIds ?? []) mine.add(id)
    anchorSeen = false
  }

  /** 当前选中里的单选候选（单选优先，其次唯一的多选成员） */
  function currentSelectionCandidate(): string | null {
    if (selectedNodeId.value) return selectedNodeId.value
    if (selectedNodeIds.value.length === 1) return selectedNodeIds.value[0] ?? null
    return null
  }

  /**
   * 幂等重应用：把画布 hidden 状态收敛到期望集合。
   *
   * @param opts.userAction 用户主动切换视图维度时为 true：
   *   先按选择模型一致性纪律清空"将被隐藏"的选中节点（切换前清选择）；
   *   watcher 驱动的被动重应用则不清选择，且跳过当前选中节点的隐藏
   *   （镜像 dockSync 的选中豁免，防 L1 揭示被立即吞回）。
   */
  function applyViewFilter(opts: { userAction?: boolean } = {}): void {
    const snapshot = nodes.value
    const mineBefore = mine.size
    let modeExited = false

    // 聚焦锚点消亡检测（水合门闩防误退）
    if (viewMode.value === 'focus' && focusAnchorId.value) {
      if (snapshot.some((n) => n.id === focusAnchorId.value)) {
        anchorSeen = true
      } else if (anchorSeen) {
        viewMode.value = 'panorama'
        focusAnchorId.value = null
        anchorSeen = false
        modeExited = true
      }
    }

    const active =
      viewMode.value === 'focus' || errorsOnly.value || hiddenGroups.value.size > 0 || mine.size > 0 // 已无活跃维度但册内还有未恢复节点 → 仍需走恢复分支
    if (!active) return

    const desiredHidden = computeViewFilterHiddenIds(snapshot, edges.value, snapshotState())

    // 水合门闩：画布尚无业务节点（空画布 / 仅 projectRoot 的水合中间态）时，
    // 册内 id「未找到」不能视为已删除——冷启动 loadBucket 回填的所有权会被
    // prune 清空并 persist 覆写桶（重载后幽灵隐藏）。与 configPath watcher
    // 的空画布守卫语义对齐：见过业务节点后才开始按「未找到」修剪。
    const hasBusinessNodes = snapshot.some((n) => getNodeFilterGroup(n.type) !== null)

    // 所有权修剪：册内节点已不可见性丢失（undo 全量替换 / Ctrl+H 全量揭示
    // / 节点已删除）→ 移出 mine；下一轮若仍该藏会重新入册（自愈）。
    // 水合中「未到达」≠「已删除」，门闩未过时保留待下轮裁决。
    for (const id of mine) {
      const node = snapshot.find((n) => n.id === id)
      if (!node) {
        if (hasBusinessNodes) mine.delete(id)
        continue
      }
      if (node.hidden !== true) mine.delete(id)
    }

    // 用户主动切换：将被隐藏的选中先清空（选择模型一致性纪律）
    if (opts.userAction) {
      const selectedHit =
        (selectedNodeId.value !== null && desiredHidden.has(selectedNodeId.value)) ||
        selectedNodeIds.value.some((id) => desiredHidden.has(id))
      if (selectedHit) clearSelection()
    }
    const selectedNow = new Set<string>([...(selectedNodeIds.value ?? [])])
    if (selectedNodeId.value) selectedNow.add(selectedNodeId.value)

    // 隐藏：只藏"当前可见且（被动重应用时）未被选中"的节点（不抢坞/模板的隐藏）
    for (const node of snapshot) {
      if (!desiredHidden.has(node.id)) continue
      if (node.hidden === true) continue // 坞聚合/模板折叠已隐藏：非我所有，不入册
      if (!opts.userAction && selectedNow.has(node.id)) continue // 选中豁免（仅被动重应用）
      updateNodeData(node.id, { hidden: true })
      mine.add(node.id)
    }

    // 恢复：册内且不再该隐藏的节点。挂靠聚合态坞的卡片所有权让渡给坞
    //（不揭示，仅出册；拆坞时 dockSync.restoreRows 自会揭示）
    for (const id of mine) {
      if (desiredHidden.has(id)) continue
      const node = snapshot.find((n) => n.id === id)
      if (!node) {
        if (hasBusinessNodes) mine.delete(id) // 水合中未到达 ≠ 已删除（见 prune 门闩）
        continue
      }
      mine.delete(id)
      if (isDockAggregatedNode(id, snapshot)) continue
      updateNodeData(id, { hidden: false })
    }

    // 被动重应用产生的所有权漂移 / 锚点消亡退全景也要落盘，
    // 否则重载时 hiddenIds 与画布 hidden 标志错位（无主 hidden）
    if (!opts.userAction && (modeExited || mine.size !== mineBefore)) {
      persist()
    }
  }

  /** 切换视图模式（panorama ↔ focus）。聚焦：捕获当前选中为锚点 */
  function setViewMode(mode: 'panorama' | 'focus'): void {
    if (mode === viewMode.value && mode === 'panorama') return
    viewMode.value = mode
    if (mode === 'focus') {
      const candidate = currentSelectionCandidate()
      const node = candidate ? nodes.value.find((n) => n.id === candidate) : undefined
      // 无合法选中 → 聚焦模式保持但无过滤（锚点 null；选中 Schema 后自动换锚）
      focusAnchorId.value = node && isFocusableType(node.type) ? node.id : null
      anchorSeen = focusAnchorId.value !== null
    } else {
      focusAnchorId.value = null
      anchorSeen = false
    }
    // 先应用后持久化：hiddenIds（所有权快照）需包含本次应用的隐藏/恢复结果
    applyViewFilter({ userAction: true })
    persist()
  }

  /** 切换"仅异常" */
  function toggleErrorsOnly(): void {
    errorsOnly.value = !errorsOnly.value
    applyViewFilter({ userAction: true })
    persist()
  }

  /** 设置某节点分组的显隐 */
  function setGroupHidden(group: NodeFilterGroup, hidden: boolean): void {
    const next = new Set(hiddenGroups.value)
    if (hidden) next.add(group)
    else next.delete(group)
    hiddenGroups.value = next
    applyViewFilter({ userAction: true })
    persist()
  }

  /** 全量重置（测试/E2E 逃生口） */
  function resetViewFilter(): void {
    viewMode.value = 'panorama'
    focusAnchorId.value = null
    errorsOnly.value = false
    hiddenGroups.value = new Set()
    anchorSeen = false
    applyViewFilter({ userAction: true })
    persist()
  }

  // --- watcher：指纹驱动的被动重应用（防抖，幂等收敛） ---
  const fingerprint = computed(() => computeViewFilterFingerprint(nodes.value, edges.value))
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  watch(
    fingerprint,
    () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        applyViewFilter()
      }, REAPPLY_DEBOUNCE_MS)
    },
    { flush: 'post' }
  )

  // --- watcher：聚焦期间选中 Schema → 实时换锚 ---
  watch(selectedNodeId, (id) => {
    if (viewMode.value !== 'focus' || !id) return
    if (focusAnchorId.value === id) return
    const node = nodes.value.find((n) => n.id === id)
    if (!node || !isSchemaNodeType(node.type)) return // 仅 Schema 换锚（见模块头注释）
    focusAnchorId.value = id
    anchorSeen = true
    applyViewFilter()
    persist()
  })

  // --- watcher：项目配置路径变化（打开/切换项目）→ 载入对应桶并应用 ---
  const configPathRef = computed(() => getEffectiveProjectConfigPath())
  watch(
    configPathRef,
    (p) => {
      loadBucket(p)
      // 画布为空（项目加载前/水合前）时跳过应用：此时 prune 会把回填的
      // 所有权（mine）当"节点已删除"清空，重载后关闭筛选就无法恢复。
      // 节点到位后 fingerprint watcher 自然触发重应用。
      if (nodes.value.length > 0) applyViewFilter()
    },
    { immediate: true }
  )

  return {
    viewMode,
    focusAnchorId,
    errorsOnly,
    hiddenGroups,
    setViewMode,
    toggleErrorsOnly,
    setGroupHidden,
    resetViewFilter,
    /** 立即重应用（跳过防抖；测试与确定性场景用） */
    applyViewFilter,
  }
}
