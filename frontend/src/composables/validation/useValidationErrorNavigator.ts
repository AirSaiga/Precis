/**
 * 校验错误导航组合式函数
 *
 * 将验证错误列表中的条目定位到对应的画布节点。
 * 节点不存在时尝试通过 V2 导入逻辑创建；存在时直接聚焦 + 居中。
 */
import { useGraphStore } from '@/stores/graphStore'
import { logger } from '@/core/utils/logger'
import { eventBus } from '@/core/eventBus'
import type { FullValidationErrorItem } from '@/api/projectValidationApi'
/** @returns navigateErrorToCanvas / focusNode / resolveErrorNodeId 等导航方法 */
export function useValidationErrorNavigator() {
  const graphStore = useGraphStore()

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

    const resourceInfo = resolveErrorResource(error)
    if (!resourceInfo) {
      logger.warn('[ValidationErrorNavigator] 无法从错误信息推断资源:', error)
      return false
    }

    try {
      const position = calculateImportPosition()
      const createdId = await graphStore.importV2ResourceToCanvas(
        resourceInfo.kind,
        resourceInfo.resourceId,
        position
      )
      if (createdId) {
        focusNode(createdId)
        return true
      }
      logger.warn('[ValidationErrorNavigator] 节点创建失败')
      return false
    } catch (err) {
      logger.error('[ValidationErrorNavigator] 自动创建节点异常:', err)
      return false
    }
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

  function resolveErrorResource(
    error: FullValidationErrorItem
  ): { kind: 'schema' | 'constraint' | 'regex'; resourceId: string } | null {
    if (error.table_id) {
      return { kind: 'schema', resourceId: error.table_id }
    }
    return null
  }

  function calculateImportPosition(): { x: number; y: number } {
    const allNodes = graphStore.nodes
    if (allNodes.length === 0) {
      return { x: 200, y: 200 }
    }
    const sumX = allNodes.reduce((acc, n) => acc + n.position.x, 0)
    const sumY = allNodes.reduce((acc, n) => acc + n.position.y, 0)
    return { x: sumX / allNodes.length + 300, y: sumY / allNodes.length }
  }

  return {
    navigateErrorToCanvas,
    resolveErrorNodeId,
    focusNode,
  }
}
