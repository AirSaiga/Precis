/**
 * Transform 转换节点断开连接处理器
 *
 * 处理上游 → transform 断开的清理：
 * - 重置 inputFromNode / inputColumn
 * - 标记为 draft
 */
import { registerDisconnectHandler } from '../registryCore'

registerDisconnectHandler({
  priority: 70,
  match: (_edge, _source, target) => target.type === 'transform',
  cleanup: (edge, source, target, ctx) => {
    ctx.updateNodeData(target.id, {
      inputFromNode: undefined,
      inputColumn: undefined,
      saveState: 'draft',
    })
  },
})
