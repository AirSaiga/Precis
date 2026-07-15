/**
 * @file useVirtualAnchorEdges.ts
 * @description 虚拟锚点边管理 composable
 *
 * 当 Schema 节点列数过多而出现垂直滚动时，滚动出视图的列对应的边需要被
 * 重新路由到虚拟锚点（virtual anchor）以保持视觉连接。该模块管理：
 * - syncVirtualAnchorEdges: 根据滚动状态同步 proxy 边
 * - watchVirtualAnchorState: 监听滚动/边变化自动触发同步
 *
 * 独立于 useSchemaConnectionHandler 中其他逻辑（连接处理、列生成、SmartFill），
 * 是 schema 节点列滚动行为特有的视图层细节。
 */

import { logger } from '@/core/utils/logger'
import { nextTick, watch } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import type { Edge } from '@vue-flow/core'
import { addEdges, findEdge, removeEdges } from '@/services/canvas/vueFlowApi'
import { useGraphStore } from '@/stores/graphStore'

const VIRTUAL_ANCHOR_TOP_ID = 'virtual-anchor-top'
const VIRTUAL_ANCHOR_BOTTOM_ID = 'virtual-anchor-bottom'

/**
 * 虚拟锚点同步只需列的 id 字段。
 * SchemaColumn 与 JsonSchemaColumn 在 .id 层面兼容，统一用此最小结构以同时支持两类节点。
 */
interface VirtualAnchorColumn {
  id: string
}

export function useVirtualAnchorEdges() {
  const store = useGraphStore()
  const { updateNodeInternals } = useVueFlow()

  /**
   * 同步虚拟锚点边：根据当前滚动出视图的列集合，添加/更新/删除对应的 proxy 边，
   * 并隐藏/恢复对应的语义边（source-right- handle 出发的真实边）。
   */
  const syncVirtualAnchorEdges = (
    nodeId: string,
    scrolledOutBySide: { top: VirtualAnchorColumn[]; bottom: VirtualAnchorColumn[] }
  ) => {
    const topSet = new Set((scrolledOutBySide.top || []).map((c) => c.id))
    const bottomSet = new Set((scrolledOutBySide.bottom || []).map((c) => c.id))

    const currentEdges = (store.edges || []) as Edge[]

    const isProxyEdge = (edge: Edge) =>
      (edge?.data as Record<string, unknown>)?.virtualAnchorProxy === true
    const isSemanticEdge = (edge: Edge) => {
      if (!edge) return false
      if (edge.source !== nodeId) return false
      if (typeof edge.sourceHandle !== 'string') return false
      if (!edge.sourceHandle.startsWith('source-right-')) return false
      if (isProxyEdge(edge)) return false
      return true
    }

    const proxyIdTop = (semanticEdgeId: string) => `${semanticEdgeId}__vaTop`
    const proxyIdBottom = (semanticEdgeId: string) => `${semanticEdgeId}__vaBottom`

    const proxyMap = new Map<string, Edge>()
    const baseEdges: Edge[] = []
    let didChange = false

    for (const edge of currentEdges) {
      if (isProxyEdge(edge) && edge.source === nodeId) {
        const originalId = edge?.data?.virtualOf
        const side = edge?.data?.side
        if (typeof originalId === 'string' && (side === 'top' || side === 'bottom')) {
          proxyMap.set(`${originalId}:${side}`, edge)
        } else {
          didChange = true
        }
        continue
      }
      baseEdges.push(edge)
    }

    const semanticEdges = baseEdges.filter(isSemanticEdge)
    if (semanticEdges.length === 0 && proxyMap.size === 0) return

    const applyHiddenToSemantic = (edge: Edge, hidden: boolean) => {
      const currentlyHidden = edge?.data?.hiddenByVirtualAnchorProxy === true
      if (hidden && !currentlyHidden) {
        didChange = true
        const prevOpacity = ((edge.style || {}) as Record<string, unknown>)?.opacity
        const prevPointerEvents = ((edge.style || {}) as Record<string, unknown>)?.pointerEvents
        return {
          ...edge,
          hidden: true,
          style: { ...(edge.style || {}), opacity: 0, pointerEvents: 'none' },
          data: {
            ...(edge.data || {}),
            hiddenByVirtualAnchorProxy: true,
            virtualAnchorPrevStyle: { opacity: prevOpacity, pointerEvents: prevPointerEvents },
          },
        } as unknown as Edge
      }
      if (!hidden && currentlyHidden) {
        didChange = true
        const prev = edge.data?.virtualAnchorPrevStyle || {}
        const restoredStyle = { ...((edge.style || {}) as Record<string, unknown>) }
        if (prev.opacity === undefined) delete restoredStyle.opacity
        else restoredStyle.opacity = prev.opacity
        if (prev.pointerEvents === undefined) delete restoredStyle.pointerEvents
        else restoredStyle.pointerEvents = prev.pointerEvents
        const { hiddenByVirtualAnchorProxy, virtualAnchorPrevStyle, ...restData } = (edge.data ||
          {}) as Record<string, unknown>
        return {
          ...edge,
          hidden: false,
          style: restoredStyle as unknown as Edge['style'],
          data: restData,
        }
      }
      if (hidden && edge.hidden !== true) {
        didChange = true
        return { ...edge, hidden: true } as unknown as Edge
      }
      if (!hidden && edge.hidden === true && !currentlyHidden) {
        didChange = true
        return { ...edge, hidden: false } as unknown as Edge
      }
      return edge
    }

    const getVisibleStyleFromSemanticEdge = (edge: Edge) => {
      const prev = edge?.data?.virtualAnchorPrevStyle || {}
      const style = { ...((edge?.style || {}) as Record<string, unknown>) }
      if (prev.opacity === undefined) delete style.opacity
      else style.opacity = prev.opacity
      if (prev.pointerEvents === undefined) delete style.pointerEvents
      else style.pointerEvents = prev.pointerEvents
      return style as unknown as Edge['style']
    }

    const buildOrUpdateProxy = (semanticEdge: Edge, side: 'top' | 'bottom', hidden: boolean) => {
      const key = `${semanticEdge.id}:${side}`
      const existing = proxyMap.get(key)
      const id = side === 'top' ? proxyIdTop(semanticEdge.id) : proxyIdBottom(semanticEdge.id)
      const anchorId = side === 'top' ? VIRTUAL_ANCHOR_TOP_ID : VIRTUAL_ANCHOR_BOTTOM_ID
      const style = getVisibleStyleFromSemanticEdge(semanticEdge)

      const base = {
        ...semanticEdge,
        id,
        sourceHandle: anchorId,
        hidden,
        style,
        data: {
          ...(semanticEdge.data || {}),
          transient: true,
          virtualAnchorProxy: true,
          virtualOf: semanticEdge.id,
          side,
          originalSourceHandle: semanticEdge.sourceHandle,
        },
      }

      if (!existing) {
        didChange = true
        proxyMap.set(key, base as unknown as Edge)
        return
      }

      const needsReplace =
        existing.id !== id ||
        existing.sourceHandle !== anchorId ||
        existing.hidden !== hidden ||
        existing.target !== semanticEdge.target ||
        existing.targetHandle !== semanticEdge.targetHandle ||
        existing.type !== semanticEdge.type

      if (needsReplace) {
        didChange = true
        proxyMap.set(key, { ...existing, ...base } as unknown as Edge)
        return
      }

      proxyMap.set(key, existing)
    }

    const nextBaseEdges = baseEdges.map((edge) => {
      if (!isSemanticEdge(edge)) return edge
      if (!edge.sourceHandle) return edge
      const columnId = edge.sourceHandle.replace('source-right-', '')
      const shouldTop = topSet.has(columnId)
      const shouldBottom = bottomSet.has(columnId)
      const hideSemantic = shouldTop || shouldBottom

      buildOrUpdateProxy(edge, 'top', !shouldTop)
      buildOrUpdateProxy(edge, 'bottom', !shouldBottom)

      return applyHiddenToSemantic(edge, hideSemantic)
    })

    const semanticEdgeIdSet = new Set(semanticEdges.map((e) => e.id))
    for (const [key, proxy] of proxyMap.entries()) {
      const originalId = key.split(':')[0] ?? key
      if (!semanticEdgeIdSet.has(originalId)) {
        proxyMap.delete(key)
        didChange = true
      } else if (
        proxy &&
        (proxy.id.endsWith('__virtualAnchorProxy') || proxy.id.includes('__virtualAnchorProxy'))
      ) {
        proxyMap.delete(key)
        didChange = true
      }
    }

    const rebuilt: Edge[] = []
    for (const edge of nextBaseEdges) {
      rebuilt.push(edge)
    }
    for (const proxy of proxyMap.values()) {
      rebuilt.push(proxy)
    }

    if (!didChange) return

    const currentById = new Map(currentEdges.map((e) => [e.id, e]))
    const rebuiltById = new Map(rebuilt.map((e) => [e.id, e]))

    const toRemove: string[] = []
    const toAdd: Edge[] = []

    for (const id of currentById.keys()) {
      if (!rebuiltById.has(id)) toRemove.push(id)
    }
    for (const [id, edge] of rebuiltById) {
      if (!currentById.has(id)) toAdd.push(edge)
    }

    if (toRemove.length > 0) removeEdges(toRemove)
    if (toAdd.length > 0) addEdges(toAdd)

    for (const newEdge of rebuilt) {
      if (!currentById.has(newEdge.id)) continue
      const vfEdge = findEdge(newEdge.id)
      if (!vfEdge) continue
      if (vfEdge.hidden !== newEdge.hidden) vfEdge.hidden = newEdge.hidden
      if (vfEdge.class !== newEdge.class) vfEdge.class = newEdge.class
      if (vfEdge.sourceHandle !== newEdge.sourceHandle) vfEdge.sourceHandle = newEdge.sourceHandle
      vfEdge.style = newEdge.style
      vfEdge.data = newEdge.data
    }
  }

  /**
   * 监听滚动状态变化，管理虚拟锚点的边
   */
  const watchVirtualAnchorState = (
    nodeId: string,
    hasScrolledOut: () => boolean,
    getScrolledOutColumnsBySide: () => {
      top: VirtualAnchorColumn[]
      bottom: VirtualAnchorColumn[]
    },
    getScrollVersion?: () => number
  ) => {
    const getSemanticSignature = () => {
      const edges = (store.edges || []) as Edge[]
      return edges
        .filter(
          (e) =>
            e.source === nodeId &&
            typeof e.sourceHandle === 'string' &&
            e.sourceHandle.startsWith('source-right-')
        )
        .map((e) => `${e.id}:${e.sourceHandle}:${e.target}:${e.targetHandle || ''}`)
        .join('|')
    }

    watch(
      [hasScrolledOut, () => (getScrollVersion ? getScrollVersion() : 0), getSemanticSignature],
      async ([hasOut]) => {
        await nextTick()
        const bySide = hasOut ? getScrolledOutColumnsBySide() : { top: [], bottom: [] }
        syncVirtualAnchorEdges(nodeId, bySide)
        updateNodeInternals([nodeId])
      },
      { immediate: true }
    )
  }

  logger.debug('[useVirtualAnchorEdges] initialized')

  return {
    syncVirtualAnchorEdges,
    watchVirtualAnchorState,
  }
}
