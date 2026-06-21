/**
 * 模板展开后置钩子类型定义
 *
 * 后置钩子用于在模板展开 DAG 创建到画布上之后，按节点类型自动执行相关逻辑。
 * 与断开清理注册表 (services/disconnect) 相同的自注册模式：
 *   - 各 handler 文件在模块顶层调用 registerTemplateExpandHandler
 *   - 通过 barrel 的 side-effect import 触发注册
 *   - templateExpand.ts 只调用 executeTemplateExpandHooks，不感知具体节点类型
 *
 * 新增节点类型的展开后逻辑：新增 registryHandlers/<type>.ts，无需修改 templateExpand.ts
 */
import type { Ref } from 'vue'
import type { Edge } from '@vue-flow/core'
import type { CustomNode, CustomNodeData } from '@/types/graph'

/**
 * 模板展开 DAG 节点（templateExpand 内部中间表示）
 *
 * 与 CustomNode 区分：templateExpand 阶段尚未挂载到画布，仅持有元数据。
 */
export interface TemplateExpandDagNode {
  id: string
  /** real = API 返回的后端节点; synthetic = 前端自动生成的 UI 节点 */
  origin: 'real' | 'synthetic'
  kind: 'transform' | 'constraint' | 'regex' | 'transformOutput' | 'manualData'
  /** real 节点的原始 API 数据 */
  item?: {
    id: string
    kind: 'transform' | 'constraint' | 'regex' | 'manualData'
    type: string
    inputFromNode: string | null
    data: Record<string, unknown>
  }
  /** 合成节点的附加数据 */
  syntheticData?: Record<string, unknown>
  /** Stage 3 填充的布局位置 */
  position?: { x: number; y: number }
}

/** 模板展开后置钩子上下文 */
export interface TemplateExpandContext {
  nodes: Ref<CustomNode[]>
  edges: Ref<Edge[]>
  updateNodeData: (nodeId: string, data: Partial<CustomNodeData>) => void
  /**
   * 重建 parent/children/outputPortConnected 关系。
   * 由调用方（graphStore）注入；与 V2 导入后的标准做法一致。
   */
  reconcileAll?: () => Promise<void>
}

/** 模板展开后置钩子 */
export interface TemplateExpandHandler {
  /**
   * 匹配函数：返回 true 表示此 handler 处理该 dagNode
   * - dagNode.kind 用于按"业务类别"路由
   * - dagNode.item.data 可携带具体类型信息（refs/params 等）
   */
  match: (dagNode: TemplateExpandDagNode, ctx: TemplateExpandContext) => boolean
  /**
   * 执行后置逻辑（计算 transform 输出、触发约束校验等）
   * - 同步或异步均可
   * - 内部异常应自行 catch，不应阻塞其他 handler
   */
  execute: (dagNode: TemplateExpandDagNode, ctx: TemplateExpandContext) => void | Promise<void>
  /**
   * 优先级（越小越先执行，默认 100）。
   * 例如：关系同步 reconcile 应在所有数据计算完成后执行（priority 200），
   *      约束校验应在数据计算完成后、关系同步前执行（priority 150）。
   */
  priority?: number
}
