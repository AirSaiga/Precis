/**
 * @file useSchemaNodeDrag.ts
 * @description Schema 节点拖拽处理 Composable
 *
 * 专门处理 Schema 节点特有的拖拽连接场景：
 * 从添加列句柄拖拽到空白区域 → 添加新列
 *
 * （历史说明：从列输出句柄拖拽创建约束节点的场景已移除，
 * 该路径现由连接调度器的"未找到对应处理器"兜底处理）
 *
 * 通过将 Schema 节点特定的逻辑提取到独立的组合式函数中，
 * 实现关注点分离，提高代码可维护性和可测试性。
 */

import { logger } from '@/core/utils/logger'
import { useGraphStore } from '@/stores/graphStore'

/**
 * Schema 节点拖拽处理返回值
 */
export interface UseSchemaNodeDragReturn {
  /**
   * 处理添加列句柄的拖拽连接结束事件
   * 当用户从添加列句柄拖拽到空白区域时触发，自动添加新列
   *
   * @param sourceNodeId - 源节点ID
   * @param event - 鼠标或触摸事件
   * @returns boolean - 是否成功处理该事件
   */
  handleAddColumnHandleDragEnd: (sourceNodeId: string, event: MouseEvent | TouchEvent) => boolean
}

/**
 * Schema 节点拖拽处理 Composable
 *
 * @example
 * ```typescript
 * const { handleAddColumnHandleDragEnd } = useSchemaNodeDrag();
 * ```
 */
export function useSchemaNodeDrag(): UseSchemaNodeDragReturn {
  // 图存储
  const store = useGraphStore()

  /**
   * 处理添加列句柄的拖拽连接结束事件
   *
   * 该函数处理从 Schema 节点添加列句柄拖拽到空白区域的场景：
   * 1. 坐标转换（屏幕坐标 → 画布坐标）
   * 2. 添加偏移量
   * 3. 调用 store 添加新列
   *
   * 注意：目前位置参数未被使用，因为 addColumnToSchema 不需要位置信息
   * 但保留位置参数以备将来扩展（如支持自定义列位置）
   *
   * @param sourceNodeId - 源节点ID
   * @param event - 鼠标或触摸事件
   * @returns boolean - 是否成功处理该事件
   */
  const handleAddColumnHandleDragEnd = (
    sourceNodeId: string,
    event: MouseEvent | TouchEvent
  ): boolean => {
    // 验证节点类型
    const node = store.nodes.find((n) => n.id === sourceNodeId)
    if (!node || node.type !== 'schema') {
      return false
    }

    // 执行添加列操作
    store.addColumnToSchema(sourceNodeId)

    logger.debug(`[useSchemaNodeDrag] 已添加新列到节点: ${sourceNodeId}`)

    return true
  }

  return {
    handleAddColumnHandleDragEnd,
  }
}
