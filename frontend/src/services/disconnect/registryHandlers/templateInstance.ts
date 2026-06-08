/**
 * TemplateInstance 模板实例断开连接处理器
 *
 * 处理上游节点 → templateInstance 断开的清理：
 * - 重置 inputFromNode
 * - 标记为 draft 待保存
 */
import { registerDisconnectHandler } from '../registryCore'

registerDisconnectHandler({
  priority: 70,
  match: (_edge, _source, target) => target.type === 'templateInstance',
  cleanup: (edge, source, target, ctx) => {
    const data = (target.data || {}) as Record<string, unknown>
    ctx.updateNodeData(target.id, {
      ...data,
      inputFromNode: undefined,
      saveState: 'draft',
    })
  },
})
