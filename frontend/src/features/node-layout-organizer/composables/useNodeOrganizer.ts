/**
 * @file useNodeOrganizer.ts
 * @description 节点布局组织组合式函数
 *
 * 功能概述：
 * - 提供完整节点整理功能
 * - 支持选中节点局部整理与快速整理
 * - 分组边界计算与分组拖拽移动
 * - 动画应用、分组折叠展开控制
 */
import { logger } from '@/core/utils/logger'
import { ref, computed, readonly } from 'vue'
import { useGraphStore } from '@/stores/graphStore'
import { LayoutCalculator } from '../core/layoutCalculator'
import { DEFAULT_ORGANIZE_OPTIONS } from '../constants'
import type { OrganizeOptions, ConnectionInfo, ZoneGroup } from '../types'
import { getDefaultDimension, getNodeDimensionsFromDOM } from '../utils/nodeDimensionHelper'
import { useVueFlow } from '@vue-flow/core'
import { isConstraintNodeType } from '@/services/constraints/validationRegistry'

/**
 * 计算整理动画的错峰索引（纯函数，便于单测）。
 *
 * 策略：先求参与整理节点的质心，再按各节点到质心的距离升序排序，
 * 归一化到 0..1。距中心越近的节点 index 越小（先动），
 * 从而产生"从中心向外涟漪"的吸附感，而非所有节点同时启停。
 *
 * @param targetPositions 参与整理的节点目标位置（含 id）
 * @param nodes  当前画布全部节点（用于读取各节点当前位置）
 * @returns nodeId -> 归一化错峰索引 [0, 1]
 */
export function computeStaggerIndices(
  targetPositions: Map<string, { x: number; y: number }>,
  nodes: Array<{ id: string; position: { x: number; y: number } }>
): Map<string, number> {
  const result = new Map<string, number>()
  if (targetPositions.size === 0) return result

  // 收集参与节点当前位置
  const nodePosMap = new Map<string, { x: number; y: number }>()
  for (const n of nodes) {
    if (targetPositions.has(n.id)) nodePosMap.set(n.id, n.position)
  }
  if (nodePosMap.size === 0) {
    // 兜底：无位置信息时全部立即启动
    for (const id of targetPositions.keys()) result.set(id, 0)
    return result
  }

  // 计算质心
  let cx = 0
  let cy = 0
  for (const p of nodePosMap.values()) {
    cx += p.x
    cy += p.y
  }
  cx /= nodePosMap.size
  cy /= nodePosMap.size

  // 按到质心距离升序排序
  const ordered = [...nodePosMap.entries()].sort((a, b) => {
    const da = (a[1].x - cx) ** 2 + (a[1].y - cy) ** 2
    const db = (b[1].x - cx) ** 2 + (b[1].y - cy) ** 2
    return da - db
  })

  // 归一化到 0..1
  const maxIdx = ordered.length - 1
  for (let i = 0; i < ordered.length; i++) {
    const entry = ordered[i]
    if (!entry) continue
    const normalized = maxIdx > 0 ? i / maxIdx : 0
    result.set(entry[0], normalized)
  }
  return result
}

/** 默认错峰间隔（ms），当 CSS 变量无法读取时兜底 */
const DEFAULT_STAGGER_MS = 60

export function useNodeOrganizer() {
  const graphStore = useGraphStore()
  const { viewport } = useVueFlow()

  const isOrganizing = ref(false)
  const lastOrganizeTime = ref<number | null>(null)
  const organizeOptions = ref<OrganizeOptions>({ ...DEFAULT_ORGANIZE_OPTIONS })
  const groups = ref<ZoneGroup[]>([])
  const showGroups = ref(true)

  const nodes = computed(() => graphStore.nodes)
  const edges = computed(() => graphStore.edges)
  const selectedNodeIds = computed(() => graphStore.selectedNodes.map((n) => n.id))

  const canvasSize = computed(() => {
    const flowContainer =
      (document.querySelector('.vue-flow__container') as HTMLElement | null) ||
      (document.querySelector('.vue-flow') as HTMLElement | null)
    if (flowContainer) {
      const rect = flowContainer.getBoundingClientRect()
      return { width: rect.width, height: rect.height }
    }
    return { width: window.innerWidth, height: window.innerHeight }
  })

  const statistics = computed(() => {
    const byCategory: Record<string, number> = {}
    const byType: Record<string, number> = {}

    for (const node of nodes.value) {
      if (!node.type) continue
      const category = node.type.replace(/Constraint|Preview|Console|Root|Toolbox|Dashboard$/, '')
      byCategory[category] = (byCategory[category] || 0) + 1
      byType[node.type] = (byType[node.type] || 0) + 1
    }

    return {
      total: nodes.value.length,
      selected: selectedNodeIds.value.length,
      byType,
      byCategory,
    }
  })

  async function organizeNodes(options?: Partial<OrganizeOptions>): Promise<void> {
    if (isOrganizing.value) return
    if (nodes.value.length === 0) return

    const mergedOptions = { ...organizeOptions.value, ...options }
    isOrganizing.value = true

    try {
      logger.debug('[useNodeOrganizer] 开始整理节点')

      const startTime = performance.now()
      const connections = extractConnections()

      const calculator = new LayoutCalculator(
        nodes.value,
        connections,
        canvasSize.value,
        mergedOptions,
        viewport.value.zoom
      )

      let targetPositions = calculator.calculate()
      groups.value = calculator.getGroups()

      targetPositions = gridAlignPositions(targetPositions, 20)

      if (groups.value.length > 0) {
        recomputeGroupBounds(groups.value, targetPositions)
        groups.value = [...groups.value]
      }

      if (mergedOptions.animate) {
        await applyAnimation(targetPositions, mergedOptions.animateDuration)
      } else {
        applyPositions(targetPositions)
      }

      const endTime = performance.now()
      lastOrganizeTime.value = Date.now()
      logger.debug(`[useNodeOrganizer] 整理完成，耗时: ${(endTime - startTime).toFixed(2)}ms`)
    } catch (error) {
      logger.error('[useNodeOrganizer] 整理失败:', error)
    } finally {
      isOrganizing.value = false
    }
  }

  async function organizeSelectedNodes(options?: Partial<OrganizeOptions>): Promise<void> {
    const selectedIds = selectedNodeIds.value
    if (selectedIds.length === 0) return

    const mergedOptions = { ...organizeOptions.value, ...options }
    isOrganizing.value = true

    try {
      const selectedNodes = nodes.value.filter((n) => selectedIds.includes(n.id))
      const connections = extractConnections().filter(
        (c) => selectedIds.includes(c.source) && selectedIds.includes(c.target)
      )

      const calculator = new LayoutCalculator(
        selectedNodes,
        connections,
        { width: selectedNodes.length * 320, height: 600 },
        mergedOptions,
        viewport.value.zoom
      )

      let targetPositions = calculator.calculate()
      targetPositions = gridAlignPositions(targetPositions, 20)

      if (mergedOptions.animate) {
        await applyAnimation(targetPositions, mergedOptions.animateDuration)
      } else {
        applyPositions(targetPositions)
      }

      lastOrganizeTime.value = Date.now()
    } catch (error) {
      logger.error('[useNodeOrganizer] 整理选中节点失败:', error)
    } finally {
      isOrganizing.value = false
    }
  }

  async function quickOrganize(): Promise<void> {
    await organizeNodes()
  }

  function extractConnections(): ConnectionInfo[] {
    const nodeTypeMap = new Map<string, string>()
    for (const node of nodes.value) {
      if (!node.type) continue
      nodeTypeMap.set(node.id, node.type)
    }
    return edges.value.map((edge) => ({
      source: edge.source,
      target: edge.target,
      sourceType: nodeTypeMap.get(edge.source) ?? '',
      targetType: nodeTypeMap.get(edge.target) ?? '',
      sourceHandle: edge.sourceHandle ?? undefined,
      targetHandle: edge.targetHandle ?? undefined,
    }))
  }

  function gridAlignPositions(
    positions: Map<string, { x: number; y: number }>,
    gridSize: number
  ): Map<string, { x: number; y: number }> {
    const result = new Map<string, { x: number; y: number }>()
    for (const [id, pos] of positions) {
      result.set(id, {
        x: Math.round(pos.x / gridSize) * gridSize,
        y: Math.round(pos.y / gridSize) * gridSize,
      })
    }
    return result
  }

  function recomputeGroupBounds(
    zoneGroups: ZoneGroup[],
    nodePositions: Map<string, { x: number; y: number }>
  ): void {
    const nodeTypeById = new Map<string, string>(
      nodes.value
        .filter((n): n is typeof n & { type: string } => !!n.type)
        .map((n) => [n.id, n.type])
    )
    const nodeIds = Array.from(nodePositions.keys())
    const domDimensions = getNodeDimensionsFromDOM(nodeIds)
    const zoom = viewport.value.zoom || 1

    const getDim = (nodeId: string) => {
      const nodeType = nodeTypeById.get(nodeId) || ''
      const domDim = domDimensions.get(nodeId)
      const fallback = (() => {
        if (nodeType === 'schema') return { width: 360, height: 440 }
        if (nodeType === 'regex') return { width: 300, height: 140 }
        if (isConstraintNodeType(nodeType)) return { width: 280, height: 120 }
        return getDefaultDimension(nodeType)
      })()
      if (domDim) {
        const scaled = { width: domDim.width / zoom, height: domDim.height / zoom }
        return {
          width: Math.max(scaled.width, fallback.width),
          height: Math.max(scaled.height, fallback.height),
        }
      }
      return fallback
    }

    for (const group of zoneGroups) {
      const ids = group.nodeIds.filter((id) => nodePositions.has(id))
      if (ids.length === 0) continue

      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity

      for (const id of ids) {
        const pos = nodePositions.get(id)
        if (!pos) continue
        const dim = getDim(id)
        minX = Math.min(minX, pos.x)
        minY = Math.min(minY, pos.y)
        maxX = Math.max(maxX, pos.x + dim.width)
        maxY = Math.max(maxY, pos.y + dim.height)
      }

      if (minX === Infinity) continue
      const depth = group.depth || 0
      const headerHeight = depth > 0 ? 22 : 28
      const paddingLeft = depth > 0 ? 28 : 48
      const paddingRight = depth > 0 ? 28 : 48
      const paddingTop = headerHeight + (depth > 0 ? 28 : 48)
      const paddingBottom = depth > 0 ? 28 : 48

      group.x = minX - paddingLeft
      group.y = minY - paddingTop
      group.width = maxX - minX + paddingLeft + paddingRight
      group.height = maxY - minY + paddingTop + paddingBottom
    }
  }

  /** 读取 --organize-stagger CSS 变量（毫秒），读不到则回退默认值 */
  function resolveStaggerMs(): number {
    const raw = getComputedStyle(document.documentElement)
      .getPropertyValue('--organize-stagger')
      .trim()
    const parsed = parseFloat(raw)
    return Number.isFinite(parsed) ? parsed : DEFAULT_STAGGER_MS
  }

  async function applyAnimation(
    targetPositions: Map<string, { x: number; y: number }>,
    duration: number
  ): Promise<void> {
    const elements: HTMLElement[] = []

    // 预计算各节点错峰索引（按到质心距离排序，0..1），产生"从中心向外涟漪"的吸附感
    const staggerIndexMap = computeStaggerIndices(targetPositions, nodes.value)

    for (const [nodeId] of targetPositions) {
      const element =
        (document.querySelector(`.vue-flow__node[data-id="${nodeId}"]`) as HTMLElement | null) ||
        (document.querySelector(`[data-id="${nodeId}"] .vue-flow__node`) as HTMLElement | null)
      if (element) {
        element.classList.add('layout-organizing')
        // 将用户设置的 duration 写入元素，修复与 CSS transition 的脱钩（P0c）
        element.style.setProperty('--organize-duration', `${duration}ms`)
        // 写入归一化错峰索引，CSS 用 calc(var(--organize-index) * var(--organize-stagger))
        element.style.setProperty('--organize-index', String(staggerIndexMap.get(nodeId) ?? 0))
        elements.push(element)
      }
    }

    applyPositions(targetPositions)

    if (elements.length > 0) {
      // 等待动画 + 最大错峰全部完成（错峰总量 = 1 * stagger）
      const maxStaggerMs = resolveStaggerMs()
      await new Promise<void>((resolve) => setTimeout(resolve, duration + maxStaggerMs))
    }

    for (const el of elements) {
      el.classList.remove('layout-organizing')
      el.style.removeProperty('--organize-duration')
      el.style.removeProperty('--organize-index')
    }
  }

  function applyPositions(positions: Map<string, { x: number; y: number }>): void {
    graphStore.nodes = nodes.value.map((node) => {
      const newPos = positions.get(node.id)
      if (!newPos) return node
      return {
        ...node,
        position: { x: newPos.x, y: newPos.y },
      }
    })
  }

  function toggleShowGroups(): void {
    showGroups.value = !showGroups.value
  }

  function dragGroup(groupId: string, deltaX: number, deltaY: number): void {
    const zoom = viewport.value.zoom || 1
    const dx = deltaX / zoom
    const dy = deltaY / zoom

    const group = groups.value.find((g) => g.id === groupId)
    if (!group) return

    group.x += dx
    group.y += dy

    const nodeIdsToMove = new Set(group.nodeIds)
    graphStore.nodes = nodes.value.map((node) => {
      if (!nodeIdsToMove.has(node.id)) return node
      return {
        ...node,
        position: {
          x: node.position.x + dx,
          y: node.position.y + dy,
        },
      }
    })
  }

  async function toggleGroupCollapse(groupId: string): Promise<void> {
    const group = groups.value.find((g) => g.id === groupId)
    if (!group) return

    group.collapsed = !group.collapsed
    group.visibleNodeIds = group.collapsed ? group.nodeIds.slice(0, 6) : group.nodeIds

    const hiddenIds = group.nodeIds.filter((id) => !group.visibleNodeIds.includes(id))
    if (hiddenIds.length === 0) {
      const positions = new Map<string, { x: number; y: number }>()
      for (const node of nodes.value) {
        positions.set(node.id, { x: node.position.x, y: node.position.y })
      }
      recomputeGroupBounds(groups.value, positions)
      groups.value = [...groups.value]
      return
    }

    const positions = new Map<string, { x: number; y: number }>()
    for (const node of nodes.value) {
      positions.set(node.id, { x: node.position.x, y: node.position.y })
    }

    const visiblePositions = group.visibleNodeIds
      .map((id) => positions.get(id))
      .filter(Boolean) as { x: number; y: number }[]

    let stackX = group.x + group.width - 60
    let stackY = group.y + group.height - 60

    if (visiblePositions.length > 0) {
      const maxX = Math.max(...visiblePositions.map((p) => p.x))
      const maxY = Math.max(...visiblePositions.map((p) => p.y))
      stackX = maxX + 20
      stackY = maxY + 20
    }

    for (let i = 0; i < hiddenIds.length; i++) {
      const id = hiddenIds[i]
      if (id === undefined) continue
      positions.set(id, {
        x: stackX + i * 6,
        y: stackY + i * 6,
      })
    }

    await applyAnimation(positions, organizeOptions.value.animateDuration)
    recomputeGroupBounds(groups.value, positions)
    groups.value = [...groups.value]
  }

  return {
    isOrganizing: readonly(isOrganizing),
    lastOrganizeTime: readonly(lastOrganizeTime),
    groups,
    nodes: readonly(nodes),
    selectedNodeIds: readonly(selectedNodeIds),
    statistics,

    organizeNodes,
    organizeSelectedNodes,
    quickOrganize,
    organizeOptions: readonly(organizeOptions),
    toggleGroupCollapse,
    dragGroup,
    showGroups: readonly(showGroups),
    toggleShowGroups,
  }
}
