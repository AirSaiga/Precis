/**
 * @file useCanvasLoadAdaptation.ts
 * @description 画布加载后自动适配组合式函数
 *
 * 职责（修复两个加载期缺陷）：
 * 1. 项目/工作区首次加载完成、节点渲染后自动执行一次 fitView —— 消除
 *    "加载示例项目后节点聚在左上角、画布大面积空白"的问题。
 * 2. 检测"零位置/缺失位置/同位置堆叠"节点，仅对受影响节点应用一次自动布局
 *    （复用 LayoutCalculator 的 Schema 中心化策略；策略未覆盖的类型用列式排布），
 *    并整体平移避开位置正常节点 —— 用户手动摆放的布局绝不被打乱。
 *
 * 触发时机（一次性守卫，避免重复触发）：
 * - canvasStore.contentLoadedEpoch 变化（项目加载/工作区恢复完成的统一信号）
 * - 工作区首次激活（activeWorkspaceId 变为会话内未见过的 id）
 * 命中后进入"待稳定"状态：节点数组再有变化会重置防抖计时器，待节点稳定
 * （加载链路上可能有多次全量替换）后执行一次适配。
 *
 * 不会触发的场景：Tab 来回切换（已激活过的工作区）、undo/redo、增量节点操作
 * （未进入待稳定状态时节点变化不产生任何动作）。
 */

import { watch, nextTick, onUnmounted } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { useGraphStore } from '@/stores/graphStore'
import { useCanvasStore } from '@/stores/canvasStore'
import { updateNode } from '@/services/canvas/vueFlowApi'
import { logger } from '@/core/utils/logger'
import { LayoutCalculator } from '../core/layoutCalculator'
import { DEFAULT_ORGANIZE_OPTIONS, LAYOUT_CONSTANTS, SAFE_FITVIEW_PADDING } from '../constants'
import { NODE_TYPE_TO_CATEGORY } from '../types'
import type { ConnectionInfo, OrganizeOptions } from '../types'
import { getDefaultDimension } from '../utils/nodeDimensionHelper'
import { detectPositionAnomalies } from '../utils/overlapDetection'
import {
  computeClearanceShift,
  computeItemsBounds,
  layoutBatchAsColumn,
  type ColumnLayoutItem,
  type PlacedItem,
  type RectBounds,
} from '../utils/batchPlacement'

/** 会话级去重：已执行过自动适配的工作区 id（跨 NodeCanvas 重建保留） */
const adaptedWorkspaceIds = new Set<string>()

/** 防抖窗口：节点数组最后一次变化 → 执行适配 的等待时间（ms）。
 * 加载链路（loadProjectFromV2 → 工作区恢复）中可能有多轮全量替换，
 * 等待节点稳定后再适配，避免中途视图被旧状态打断。 */
const SETTLE_DEBOUNCE_MS = 160

/** 防抖硬上限：首次 arm 起最迟多少 ms 内必须执行适配（防抖重置不延长它）。
 * 慢环境（CI/低配机）下加载链路的节点变更流（水合/校验回写）可持续数秒，
 * 若无限重置防抖，fitView 会迟到数秒——落在用户已经开始画布交互之后，
 * 视口突跳会把用户刚放好的节点甩到 MiniMap/面板之下（点击被遮挡、
 * 连线落点漂移）。宁可对部分内容提前取景，也不允许迟到取景。 */
const SETTLE_HARD_CAP_MS = 2500

/** 列式排布的行间距（约束节点高度约 100，加 60 间距 ≈ 原导入列的 160 步进） */
const COLUMN_ROW_GAP = 60

/** 重排块与既有内容的最小净空距离 */
const CLEARANCE_GAP = 60

/** 位置网格对齐粒度（与 useNodeOrganizer 的 gridAlignPositions 一致） */
const GRID_SIZE = 20

export function useCanvasLoadAdaptation(): void {
  const store = useGraphStore()
  const canvasStore = useCanvasStore()
  const { fitView } = useVueFlow()

  let settleTimer: ReturnType<typeof setTimeout> | null = null
  let hardCapTimer: ReturnType<typeof setTimeout> | null = null
  let armed = false

  /** 进入待稳定状态并重启防抖（硬上限窗口只开一次，同一次加载的多次 arm 共享） */
  function arm(): void {
    armed = true
    if (hardCapTimer === null) {
      hardCapTimer = setTimeout(() => {
        hardCapTimer = null
        if (!armed) return
        armed = false
        if (settleTimer !== null) {
          clearTimeout(settleTimer)
          settleTimer = null
        }
        void runAdaptation()
      }, SETTLE_HARD_CAP_MS)
    }
    restartSettleTimer()
  }

  function restartSettleTimer(): void {
    if (settleTimer !== null) clearTimeout(settleTimer)
    settleTimer = setTimeout(() => {
      settleTimer = null
      if (!armed) return
      armed = false
      void runAdaptation()
    }, SETTLE_DEBOUNCE_MS)
  }

  /** 项目加载/工作区恢复完成信号 */
  watch(
    () => canvasStore.contentLoadedEpoch,
    () => {
      arm()
    }
  )

  /** 工作区首次激活（会话内未见过的 id 才触发，Tab 来回切换不重复触发） */
  watch(
    () => canvasStore.activeWorkspaceId,
    (id) => {
      if (!id || adaptedWorkspaceIds.has(id)) return
      adaptedWorkspaceIds.add(id)
      arm()
    }
  )

  /** 待稳定状态下节点数组变化 → 重启防抖（等待加载链路的多轮替换完成） */
  watch(
    () => store.nodes,
    () => {
      if (armed) restartSettleTimer()
    }
  )

  onUnmounted(() => {
    if (settleTimer !== null) {
      clearTimeout(settleTimer)
      settleTimer = null
    }
    if (hardCapTimer !== null) {
      clearTimeout(hardCapTimer)
      hardCapTimer = null
    }
    armed = false
  })

  /** 适配主流程：先修复位置异常（如有），再自动取景 */
  async function runAdaptation(): Promise<void> {
    // 无节点时不取景（空画布 fitView 无意义且可能视口跳变）
    if (store.nodes.length === 0) return
    try {
      const moved = fixPositionAnomalies()
      // 遵守时序纪律：修复可能移动了节点，等 Vue Flow 完成处理与渲染后再取景
      await nextTick()
      if (moved) await nextTick()
      // 安全留白见 SAFE_FITVIEW_PADDING 注释（右下 MiniMap/右侧检查器/底部状态栏）。
      // duration: 0 瞬时完成，不留动画窗口（慢环境下动画会与用户/测试的画布交互
      // 重叠，导致点击落点漂移）。
      fitView({ padding: { ...SAFE_FITVIEW_PADDING }, duration: 0 })
      if (moved) {
        logger.info('[useCanvasLoadAdaptation] 已修复 %d 个位置异常节点并自动取景', moved)
      }
    } catch (err) {
      logger.warn('[useCanvasLoadAdaptation] 加载适配失败:', err)
    }
  }

  /** 画布容器尺寸（布局策略需要画布宽高做网格排布参考） */
  function getCanvasSize(): { width: number; height: number } {
    const el = document.querySelector('.vue-flow') as HTMLElement | null
    if (el) {
      const rect = el.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        return { width: rect.width, height: rect.height }
      }
    }
    return { width: window.innerWidth, height: window.innerHeight }
  }

  /** 提取子集内部的连接关系（供布局策略参考） */
  function extractConnections(nodeIdSet: Set<string>): ConnectionInfo[] {
    const typeById = new Map<string, string>()
    for (const n of store.nodes) {
      if (n.type && nodeIdSet.has(n.id)) typeById.set(n.id, n.type)
    }
    return store.edges
      .filter((e) => nodeIdSet.has(e.source) && nodeIdSet.has(e.target))
      .map((e) => ({
        source: e.source,
        target: e.target,
        sourceType: typeById.get(e.source) ?? '',
        targetType: typeById.get(e.target) ?? '',
        sourceHandle: e.sourceHandle ?? undefined,
        targetHandle: e.targetHandle ?? undefined,
      }))
  }

  /** 节点矩形（位置 + 类型默认尺寸；加载早期 DOM 尚未测量时的一致兜底） */
  function nodeToPlacedItem(node: {
    id: string
    type?: string
    position: { x: number; y: number }
  }): PlacedItem {
    const dim = getDefaultDimension(node.type ?? '')
    return { position: node.position, width: dim.width, height: dim.height }
  }

  /** 把位移量按 20px 网格向外取整（保持与整理功能的网格对齐观感，且不缩小净空） */
  function roundShiftOutward(delta: number): number {
    if (delta === 0) return 0
    return delta > 0
      ? Math.ceil(delta / GRID_SIZE) * GRID_SIZE
      : Math.floor(delta / GRID_SIZE) * GRID_SIZE
  }

  /**
   * 修复位置异常：仅移动受影响节点，返回移动的节点数。
   *
   * 流程：
   * 1. detectPositionAnomalies 找出受影响节点（零/缺失位置、同位置堆叠）
   * 2. 策略支持的类型复用 LayoutCalculator（Schema 中心化布局）计算理想位置
   * 3. 策略未覆盖的类型（templateInstance 等）列式排布在已算内容的右侧净空处
   * 4. 整体平移避开位置正常节点（用户手动布局不受干扰）
   * 5. 经 vueFlowApi.updateNode 增量应用（不直接改 node.position）
   */
  function fixPositionAnomalies(): number {
    const anomalies = detectPositionAnomalies(store.nodes)
    if (anomalies.affectedIds.length === 0) return 0

    const affectedSet = new Set(anomalies.affectedIds)
    const affected = store.nodes.filter((n) => affectedSet.has(n.id))
    const unaffected = store.nodes.filter((n) => !affectedSet.has(n.id))

    // 2) 策略支持的类型：复用 Schema 中心化布局算法
    const classified = affected.filter((n) => n.type && NODE_TYPE_TO_CATEGORY[n.type])
    const positions = new Map<string, { x: number; y: number }>()
    if (classified.length > 0) {
      const options: OrganizeOptions = { ...DEFAULT_ORGANIZE_OPTIONS, animate: false }
      const calculator = new LayoutCalculator(
        classified,
        extractConnections(new Set(classified.map((n) => n.id))),
        getCanvasSize(),
        options,
        1
      )
      for (const [id, pos] of calculator.calculate()) {
        positions.set(id, pos)
      }
    }

    // 3) 策略未覆盖的类型：列式排布（锚点取"已算内容/既有内容"右侧的净空起点）
    const leftover = affected.filter((n) => !positions.has(n.id))
    if (leftover.length > 0) {
      const anchor = computeColumnAnchor(positions, unaffected)
      const items: ColumnLayoutItem[] = leftover.map((n) => {
        const dim = getDefaultDimension(n.type ?? '')
        return { id: n.id, width: dim.width, height: dim.height }
      })
      for (const [id, pos] of layoutBatchAsColumn(items, anchor, COLUMN_ROW_GAP)) {
        positions.set(id, pos)
      }
    }

    if (positions.size === 0) return 0

    // 4) 整体平移避开位置正常节点
    if (unaffected.length > 0) {
      const placedItems: PlacedItem[] = []
      const dimById = new Map<string, { width: number; height: number }>()
      for (const n of affected) {
        const dim = getDefaultDimension(n.type ?? '')
        dimById.set(n.id, dim)
        const pos = positions.get(n.id)
        if (pos) placedItems.push({ position: pos, width: dim.width, height: dim.height })
      }
      const block = computeItemsBounds(placedItems)
      const obstacles: RectBounds[] = unaffected.map((n) => {
        const item = nodeToPlacedItem(n)
        return {
          minX: item.position.x,
          minY: item.position.y,
          maxX: item.position.x + item.width,
          maxY: item.position.y + item.height,
        }
      })
      if (block) {
        const raw = computeClearanceShift(block, obstacles, CLEARANCE_GAP)
        const dx = roundShiftOutward(raw.dx)
        const dy = roundShiftOutward(raw.dy)
        if (dx !== 0 || dy !== 0) {
          for (const [id, pos] of positions) {
            positions.set(id, { x: pos.x + dx, y: pos.y + dy })
          }
        }
      }
    }

    // 5) 增量应用（vueFlowApi.updateNode 统一入口）
    let movedCount = 0
    for (const [id, pos] of positions) {
      const node = store.nodes.find((n) => n.id === id)
      if (!node) continue
      if (Math.abs(node.position.x - pos.x) < 1 && Math.abs(node.position.y - pos.y) < 1) continue
      updateNode(id, { position: { x: pos.x, y: pos.y } })
      movedCount++
    }
    return movedCount
  }

  /** 列式排布锚点：取"已算布局块 / 位置正常节点"整体的右侧净空起点 */
  function computeColumnAnchor(
    positions: Map<string, { x: number; y: number }>,
    unaffected: ReadonlyArray<{ id: string; type?: string; position: { x: number; y: number } }>
  ): { x: number; y: number } {
    let maxX = -Infinity
    for (const pos of positions.values()) {
      maxX = Math.max(maxX, pos.x)
    }
    for (const n of unaffected) {
      const dim = getDefaultDimension(n.type ?? '')
      maxX = Math.max(maxX, n.position.x + dim.width)
    }
    const x = Number.isFinite(maxX)
      ? maxX + LAYOUT_CONSTANTS.CONSTRAINT_COLUMNS_GAP
      : LAYOUT_CONSTANTS.CANVAS_PADDING
    return { x, y: LAYOUT_CONSTANTS.CANVAS_PADDING }
  }
}
