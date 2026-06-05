
import { useGraphStore } from '@/stores/graphStore'
import { useProjectStore } from '@/stores/projectStore'
import { logger } from '@/core/utils/logger'
import { eventBus } from '@/core/eventBus'
import type { FullValidationErrorItem } from '@/api/projectValidationApi'

export function useValidationErrorNavigator() {
  const graphStore = useGraphStore()
  const projectStore = useProjectStore()

  /**
   * 将验证错误定位到画布节点
   * 如果节点不存在，尝试创建（复用 V2 导入逻辑）
   */
  async function navigateErrorToCanvas(error: FullValidationErrorItem): Promise<boolean> {
    const nodeId = resolveErrorNodeId(error)
    if (!nodeId) {
      logger.warn('[ValidationErrorNavigator] 无法解析错误对应的节点:', error)
      return false
    }

    // 检查节点是否已在画布上
    const existingNode = graphStore.nodes.find((n) => n.id === nodeId)

    if (existingNode) {
      // 节点存在，直接聚焦
      focusNode(nodeId)
      return true
    }

    // 节点不存在，需要创建
    // TODO: 调用 importV2ResourceToCanvas 创建节点
    // 这需要知道资源类型和 ID，目前从错误信息中难以完全推断
    // 暂时返回 false，等待后续实现
    logger.warn('[ValidationErrorNavigator] 节点不在画布上，自动创建尚未实现:', nodeId)
    return false
  }

  /**
   * 查找错误对应的画布节点 ID
   */
  function resolveErrorNodeId(error: FullValidationErrorItem): string | null {
    // 优先使用 table_id
    if (error.table_id) {
      return error.table_id
    }

    // 尝试从 table 名称匹配
    if (error.table) {
      const node = graphStore.nodes.find((n) => {
        const data = n.data as Record<string, unknown> | undefined
        return data?.tableName === error.table || data?.configName === error.table
      })
      if (node) {
        return node.id
      }
    }

    // 尝试从 source_file 推断
    if (error.source_file) {
      const fileName = error.source_file.split(/[\\/]/).pop()
      if (fileName) {
        const node = graphStore.nodes.find((n) => {
          const data = n.data as Record<string, unknown> | undefined
          const source = data?.source as { path?: string } | undefined
          const sourcePath = String(source?.path || data?.sourcePath || '')
          return sourcePath.includes(fileName)
        })
        if (node) {
          return node.id
        }
      }
    }

    return null
  }

  /**
   * 聚焦到指定节点
   */
  function focusNode(nodeId: string): void {
    // 先选中节点
    graphStore.setSelectedNode(nodeId)

    // 触发画布聚焦事件
    eventBus.emit('focus-canvas-nodes', { nodeIds: [nodeId] })
  }

  return {
    navigateErrorToCanvas,
    resolveErrorNodeId,
    focusNode,
  }
}
