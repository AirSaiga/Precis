/**
 * Constraint 节点的模板展开后置钩子
 *
 * 模板展开走 addEdges 直通路径，绕过了 useConnections.onConnect 中的
 * dispatchValidation / validateForInlineSource 派发逻辑。
 *
 * 模板展开的 DAG 是自包含的，约束的源节点只会是 transformOutput 或 manualData
 * （行内数据源），不会出现 Schema / JsonSchema。因此只需调用 validateForInlineSource。
 */
import { registerTemplateExpandHandler } from '../registryCore'
import { isConstraintNodeType } from '@/services/constraints/validationRegistry'
import { validateForInlineSource } from '@/services/constraints/validationRegistryCore'

registerTemplateExpandHandler({
  priority: 150,
  match: (dagNode, ctx) => {
    if (dagNode.kind !== 'constraint' || !dagNode.item) return false
    const constraintNode = ctx.nodes.value.find((n) => n.id === dagNode.id)
    if (!constraintNode || !isConstraintNodeType(constraintNode.type)) return false
    // 只处理行内数据源场景（transformOutput / manualData）
    const sourceEdge = ctx.edges.value.find((e) => e.target === dagNode.id)
    if (!sourceEdge) return false
    const sourceNode = ctx.nodes.value.find((n) => n.id === sourceEdge.source)
    return sourceNode?.type === 'transformOutput' || sourceNode?.type === 'manualData'
  },
  execute: async (dagNode, ctx) => {
    const constraintNode = ctx.nodes.value.find((n) => n.id === dagNode.id)
    if (!constraintNode) return
    const sourceEdge = ctx.edges.value.find((e) => e.target === dagNode.id)
    if (!sourceEdge) return
    const sourceNode = ctx.nodes.value.find((n) => n.id === sourceEdge.source)
    if (!sourceNode) return

    await validateForInlineSource({
      sourceNodeId: sourceNode.id,
      constraintNode,
      nodes: ctx.nodes.value,
      updateNodeData: ctx.updateNodeData,
    })
  },
})
