import type { Node, Edge } from '@vue-flow/core'
import type { Ref } from 'vue'
import type { CustomNode, CustomNodeData } from '@/types/graph'

/** 断开清理上下文 */
export interface DisconnectContext {
  nodes: Ref<CustomNode[]>
  edges: Ref<Edge[]>
  updateNodeData: (nodeId: string, data: Partial<CustomNodeData>) => void
  syncOnDisconnect: (edge: Edge) => void
  /** 仅在 DataSourceToSchema handler 中使用 */
  clearAllValidationErrors: (schemaNodeId: string) => void
}

/** 断开清理处理器 */
export interface DisconnectHandler {
  /** 匹配函数：返回 true 表示此 handler 处理该边 */
  match: (edge: Edge, sourceNode: Node | undefined, targetNode: Node | undefined, ctx: DisconnectContext) => boolean
  /** 执行清理 */
  cleanup: (edge: Edge, sourceNode: Node | undefined, targetNode: Node | undefined, ctx: DisconnectContext) => void
  /** 优先级（越小越先执行，默认 100）。数据源清理优先级最高。 */
  priority?: number
}
