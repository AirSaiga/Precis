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

export function useNodeTypeRegistry() {
  registerConstraintNodeLibrary()

  const nodeTypes: Record<string, NodeComponent> = {
    projectRoot: markRaw(ProjectRootNode) as unknown as NodeComponent,
    patternToolbox: markRaw(PatternToolboxNode) as unknown as NodeComponent,
    pattern: markRaw(PatternNode) as unknown as NodeComponent,
    constraintDashboard: markRaw(ConstraintDashboardNode) as unknown as NodeComponent,
    schema: markRaw(SchemaNode) as unknown as NodeComponent,
    sourcePreview: markRaw(SourcePreviewNode) as unknown as NodeComponent,
    jsonSourcePreview: markRaw(JsonSourcePreviewNode) as unknown as NodeComponent,
    jsonSchema: markRaw(JsonSchemaNode) as unknown as NodeComponent,
    regex: markRaw(RegexNode) as unknown as NodeComponent,
    transform: markRaw(TransformNode) as unknown as NodeComponent,
    transformOutput: markRaw(TransformOutputNode) as unknown as NodeComponent,
    manualData: markRaw(ManualDataNode) as unknown as NodeComponent,
    templateInstance: markRaw(TemplateInstanceNode) as unknown as NodeComponent,
    ...(constraintNodeRegistry.notNull?.component && {
      notNullConstraint: constraintNodeRegistry.notNull.component as unknown as NodeComponent,
    }),
    ...(constraintNodeRegistry.unique?.component && {
      uniqueConstraint: constraintNodeRegistry.unique.component as unknown as NodeComponent,
    }),
    ...(constraintNodeRegistry.foreignKey?.component && {
      foreignKeyConstraint: constraintNodeRegistry.foreignKey.component as unknown as NodeComponent,
    }),
    ...(constraintNodeRegistry.allowedValues?.component && {
      allowedValuesConstraint: constraintNodeRegistry.allowedValues.component as unknown as NodeComponent,
    }),
    ...(constraintNodeRegistry.range?.component && {
      rangeConstraint: constraintNodeRegistry.range.component as unknown as NodeComponent,
    }),
    ...(constraintNodeRegistry.conditional?.component && {
      conditionalConstraint: constraintNodeRegistry.conditional.component as unknown as NodeComponent,
    }),
    ...(constraintNodeRegistry.scripted?.component && {
      scriptedConstraint: constraintNodeRegistry.scripted.component as unknown as NodeComponent,
    }),
    ...(constraintNodeRegistry.charset?.component && {
      charsetConstraint: constraintNodeRegistry.charset.component as unknown as NodeComponent,
    }),
    ...(constraintNodeRegistry.dateLogic?.component && {
      dateLogicConstraint: constraintNodeRegistry.dateLogic.component as unknown as NodeComponent,
    }),
    ...(constraintNodeRegistry.composite?.component && {
      compositeConstraint: constraintNodeRegistry.composite.component as unknown as NodeComponent,
    }),
  }

  const edgeTypes: Record<string, EdgeComponent> = {
    smoothstep: markRaw(DeletableEdge) as unknown as EdgeComponent,
  }

  return {
    nodeTypes,
    edgeTypes,
  }
}
