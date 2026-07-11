/**
 * @file useRegexValidation.ts
 * @description 正则表达式校验逻辑组合式函数（edge-driven）
 *
 * 校验流程：
 * 1. 从 edges 中解析 regex 节点的上游 Schema/Column（resolveRegexSource）
 * 2. 调用 validateRegexNode 执行校验
 * 3. 更新 regex 节点的校验状态和统计信息
 */

import { logger } from '@/core/utils/logger'
import { useGraphStore } from '@/stores/graphStore'
import { resolveRegexSource } from '@/services/regex/regexEdgeResolver'
import { validateRegexNode } from '@/services/regex/regexValidationHandler'
import { useToast } from '@/composables/shared'
import { useI18n } from 'vue-i18n'
import { findEdge } from '@/services/canvas/vueFlowApi'
/**
 * 正则校验逻辑组合式函数
 */
export function useRegexValidation() {
  const { t } = useI18n()
  const store = useGraphStore()
  const { error: showError } = useToast()

  let currentAbortController: AbortController | null = null

  const handleRegexValidate = async (regexNodeId: string): Promise<void> => {
    const regexNode = store.nodes.find((node) => node.id === regexNodeId)
    if (!regexNode) {
      showError(t('inspector.regexNode.validation.nodeNotFound'))
      return
    }

    const source = resolveRegexSource(regexNodeId, store.nodes, store.edges)
    if (!source) {
      showError(t('inspector.regexNode.validation.sourceNotConnected'))
      return
    }

    await performRegexValidation(regexNodeId)
  }

  const handleRegexBadgeClick = (_regexNodeId: string) => {
    // 当前仅作为回调占位，无需实现
  }

  const performRegexValidation = async (
    regexNodeId: string,
    _schemaNodeId?: string,
    _columnName?: string
  ) => {
    currentAbortController?.abort()
    currentAbortController = new AbortController()

    try {
      const regexNode = store.nodes.find((node) => node.id === regexNodeId)
      if (!regexNode) return

      const source = resolveRegexSource(regexNodeId, store.nodes, store.edges)
      if (!source) return

      await validateRegexNode({
        regexNode,
        sourceNode: source.sourceNode,
        columnName: source.columnName,
        columnId: source.columnId,
        nodes: store.nodes,
        edges: store.edges,
        updateNodeData: store.updateNodeData as unknown as (
          nodeId: string,
          data: Record<string, unknown>
        ) => void,
        signal: currentAbortController.signal,
      })
    } catch (error) {
      logger.error('正则校验执行失败:', error)
    }
  }

  const handleRegexPatternUpdated = async (detail: { nodeId: string; reason: string }) => {
    const { nodeId } = detail

    const regexNode = store.nodes.find(
      (n) => n.id === nodeId && (n.type === 'regex' || n.type === 'regexExtract')
    )
    if (!regexNode) return

    const source = resolveRegexSource(nodeId, store.nodes, store.edges)
    if (!source) return

    await performRegexValidation(nodeId)
  }

  const updateRegexConnectionEdges = (
    regexNodeId: string,
    validationStatus: 'pass' | 'error' | 'idle'
  ) => {
    try {
      for (const edge of store.edges) {
        // Bug 4.1 修复：按结构匹配 regex 边（target + targetHandle），而非依赖 label
        if (edge.target !== regexNodeId) continue
        if (
          edge.targetHandle !== 'regex-input' &&
          edge.targetHandle !== 'regexExtract-input' &&
          edge.targetHandle !== undefined
        )
          continue

        let className = ''
        if (typeof edge.class === 'string') {
          className = edge.class
            .replace(/validation-pass/g, '')
            .replace(/validation-error/g, '')
            .replace(/validation-idle/g, '')
            .trim()
        }

        const updatedClassName =
          validationStatus === 'idle'
            ? className
            : `${className} validation-${validationStatus}`.trim()

        const vfEdge = findEdge(edge.id)
        if (vfEdge) {
          vfEdge.class = updatedClassName || undefined
        }
      }
    } catch (error) {
      logger.error('更新连接线状态失败:', error)
    }
  }

  return {
    handleRegexValidate,
    handleRegexBadgeClick,
    performRegexValidation,
    updateRegexConnectionEdges,
    handleRegexPatternUpdated,
  }
}
