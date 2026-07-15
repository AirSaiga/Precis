/**
 * @file useNodeTypeRegistry.ts
 * @description 画布节点类型注册组合式函数
 *
 * 职责：
 * - 注册约束节点库
 * - 构建 VueFlow 节点类型映射表
 */

import { markRaw } from 'vue'
import type { NodeComponent, EdgeComponent } from '@vue-flow/core'
import DeletableEdge from '@/components/canvas/edges/DeletableEdge.vue'
import ProjectRootNode from '@/components/nodes/root/ProjectRootNode.vue'
import SchemaNode from '@/components/nodes/core/SchemaNode.vue'
import SourcePreviewNode from '@/components/nodes/core/SourcePreviewNode.vue'
import JsonSourcePreviewNode from '@/components/nodes/json/JsonSourcePreviewNode.vue'
import JsonSchemaNode from '@/components/nodes/json/JsonSchemaNode.vue'
import RegexNode from '@/features/regex/components/RegexNode.vue'
import TransformNode from '@/components/nodes/transform/TransformNode.vue'
import TransformOutputNode from '@/components/nodes/transform/TransformOutputNode.vue'
import ManualDataNode from '@/components/nodes/manualData/ManualDataNode.vue'
import TemplateInstanceNode from '@/components/nodes/template/TemplateInstanceNode.vue'
import PatternToolboxNode from '@/components/nodes/patterns/PatternToolboxNode.vue'
import PatternNode from '@/components/nodes/patterns/PatternNode.vue'
import ConstraintDashboardNode from '@/components/nodes/constraints/ConstraintDashboardNode.vue'
import { constraintNodeRegistry } from '@/services/registry/constraintNodeRegistry'
import { registerConstraintNodeLibrary } from '@/components/nodes/constraintRules/ConstraintNodeLibrary'

/**
 * 将原始 Vue 组件标记为非响应式并断言为 VueFlow 的 NodeComponent 类型。
 *
 * 集中此处的 as unknown as 断言（AGENTS.md 追踪的类型逃逸债务），
 * 使调用处保持零断言；VueFlow 的 NodeComponent 与 Vue defineComponent 的类型差异在此统一收敛。
 */
const rawNode = (component: object): NodeComponent => markRaw(component) as unknown as NodeComponent

export function useNodeTypeRegistry() {
  registerConstraintNodeLibrary()

  // 静态节点：固定类型 → 固定组件
  const nodeTypes: Record<string, NodeComponent> = {
    projectRoot: rawNode(ProjectRootNode),
    patternToolbox: rawNode(PatternToolboxNode),
    pattern: rawNode(PatternNode),
    constraintDashboard: rawNode(ConstraintDashboardNode),
    schema: rawNode(SchemaNode),
    sourcePreview: rawNode(SourcePreviewNode),
    jsonSourcePreview: rawNode(JsonSourcePreviewNode),
    jsonSchema: rawNode(JsonSchemaNode),
    regex: rawNode(RegexNode),
    regexExtract: rawNode(RegexNode),
    transform: rawNode(TransformNode),
    transformOutput: rawNode(TransformOutputNode),
    manualData: rawNode(ManualDataNode),
    templateInstance: rawNode(TemplateInstanceNode),
  }

  // 约束节点：遍历注册表，画布 key 统一为 `${kind}Constraint`。
  // 约束组件在 registerConstraintNodeLibrary 内已 markRaw，此处仅做类型断言。
  for (const [kind, reg] of Object.entries(constraintNodeRegistry)) {
    if (reg?.component) {
      nodeTypes[`${kind}Constraint`] = reg.component
    }
  }

  const edgeTypes: Record<string, EdgeComponent> = {
    smoothstep: markRaw(DeletableEdge) as unknown as EdgeComponent,
  }

  return {
    nodeTypes,
    edgeTypes,
  }
}
