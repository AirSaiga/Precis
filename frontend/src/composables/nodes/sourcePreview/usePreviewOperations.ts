/**
 * @file usePreviewOperations.ts
 * @description 数据源预览节点操作
 * 负责节点删除等操作
 */

/**
 * 数据源预览节点操作
 * @param props - 组件属性
 * @returns 节点操作相关的方法
 */
import { logger } from '@/core/utils/logger'
import { NodeDeletionManager } from '@/services/managers/nodeDeletionManager'

export function usePreviewOperations(props: { id: string }) {
  /**
   * 处理节点移除
   */
  const handleRemove = async () => {
    const manager = NodeDeletionManager.getInstance()
    await manager.delete(props.id)
  }

  /**
   * 节点复制（预留）
   */
  const handleCopy = () => {
    logger.debug('节点复制功能待实现')
  }

  return {
    handleRemove,
    handleCopy,
  }
}
