/**
 * Regex 正则节点断开连接处理器
 *
 * 处理 schema → regex 断开的清理：
 * - 重置 sourceNodeId / sourceColumnName / sourceRef
 * - 清除校验状态
 */
import { registerDisconnectHandler } from '../registryCore'

registerDisconnectHandler({
  priority: 50,
  match: (_edge, _source, target) => target.type === 'regex',
  cleanup: (edge, source, target, ctx) => {
    const data = (target.data || {}) as Record<string, unknown>
    ctx.updateNodeData(target.id, {
      ...data,
      sourceNodeId: undefined,
      sourceColumnName: undefined,
      sourceRef: undefined,
      validationStatus: 'idle',
      errorCount: undefined,
      totalRows: undefined,
      matchCount: undefined,
      lastValidationTime: undefined,
      saveState: 'draft',
    })
  },
})
