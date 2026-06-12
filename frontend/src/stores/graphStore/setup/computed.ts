/**
 * GraphStore 计算属性模块
 *
 * 定义 selectedNode / selectedNodes / activeRegexNode / activeSchemaNode 等计算属性，
 * 以及基于状态变化的 watch 逻辑。
 */
import { computed, watch } from 'vue'
import {
  isConstraintNodeType,
  validateForInlineSource,
} from '@/services/constraints/validationRegistry'
import { logger } from '@/core/utils/logger'
import type { GraphStoreState } from './state'

/** @returns 包含 selectedNode / selectedNodes / hasMultipleSelection 等计算属性的对象 */
export function createGraphStoreComputed(state: GraphStoreState) {
  const selectedNode = computed(() => {
    return state.nodes.value.find((node) => node.id === state.selectedNodeId.value) || null
  })

  const selectedNodes = computed(() => {
    return state.nodes.value.filter((node) => state.selectedNodeIds.value.includes(node.id))
  })

  const hasMultipleSelection = computed(() => {
    return state.selectedNodeIds.value.length > 1
  })

  const activeRegexNode = computed(() => {
    if (!state.activeRegexNodeId.value) return null
    return state.nodes.value.find((node) => node.id === state.activeRegexNodeId.value) || null
  })

  const inlineSourceFingerprint = computed(() => {
    let fp = ''
    for (const n of state.nodes.value) {
      if (n.type === 'manualData' || n.type === 'transformOutput') {
        const d = (n.data || {}) as Record<string, unknown>
        fp += `${n.id}:${JSON.stringify((d.rows as string[][]) || [])}|`
      }
    }
    return fp
  })

  let inlineValidationDebounce: ReturnType<typeof setTimeout> | null = null

  watch(
    inlineSourceFingerprint,
    (newVal, oldVal) => {
      if (!oldVal || newVal === oldVal) return

      if (inlineValidationDebounce) clearTimeout(inlineValidationDebounce)

      inlineValidationDebounce = setTimeout(() => {
        for (const node of state.nodes.value) {
          if (node.type !== 'manualData' && node.type !== 'transformOutput') continue

          const constraintEdges = state.edges.value.filter((e) => e.source === node.id)
          for (const edge of constraintEdges) {
            const constraintNode = state.nodes.value.find((n) => n.id === edge.target)
            if (!constraintNode || !isConstraintNodeType(constraintNode.type)) continue

            validateForInlineSource({
              sourceNodeId: node.id,
              constraintNode,
              nodes: state.nodes.value,
              updateNodeData: state.updateNodeData,
            }).catch((err) => {
              logger.warn('Inline auto-revalidation failed:', err)
            })
          }
        }
      }, 400) // 400ms 防抖，避免输入过程中频繁触发校验
    },
    { flush: 'post' }
  )

  return {
    selectedNode,
    selectedNodes,
    hasMultipleSelection,
    activeRegexNode,
  }
}

export type GraphStoreComputed = ReturnType<typeof createGraphStoreComputed>
