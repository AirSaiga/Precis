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
      }

      applyPositions(targetPositions)
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

  async function applyAnimation(
    targetPositions: Map<string, { x: number; y: number }>,
    duration: number
  ): Promise<void> {
    const elements: HTMLElement[] = []

    for (const [nodeId] of targetPositions) {
      const element =
        (document.querySelector(`.vue-flow__node[data-id="${nodeId}"]`) as HTMLElement | null) ||
        (document.querySelector(`[data-id="${nodeId}"] .vue-flow__node`) as HTMLElement | null)
      if (element) {
        element.classList.add('layout-organizing')
        elements.push(element)
      }
    }

    applyPositions(targetPositions)

    if (elements.length > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, duration))
    }

    for (const el of elements) {
      el.classList.remove('layout-organizing')
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
