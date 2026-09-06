/*
 * SPDX-License-Identifier: Apache-2.0
 *
 * Copyright 2026 Precis Team
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
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
import { withNodePositionIsolation } from '@/components/nodes/shared/nodePositionShell'
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
export const rawNode = (component: object): NodeComponent =>
  markRaw(component) as unknown as NodeComponent

export function useNodeTypeRegistry() {
  registerConstraintNodeLibrary()

  // 全部节点类型统一包位置隔离壳（M1 组件重渲隔离）：NodeWrapper 每 tick 向节点
  // 组件传新的 position 对象与新建 events 容器，业务组件（未声明这些 prop）因
  // fallthrough attrs 引用变化被强制整树重渲——拖拽/整理落位的每帧主要渲染开销。
  // 壳剥离 position 并逐 key 稳定化其余 attrs，业务组件仅在 data/selected 等
  // 真实变化时重渲；见 nodePositionShell.ts 头注释。
  const shell = (component: unknown, name: string): NodeComponent =>
    rawNode(withNodePositionIsolation(component, name))

  // 静态节点：固定类型 → 固定组件
  const nodeTypes: Record<string, NodeComponent> = {
    projectRoot: shell(ProjectRootNode, 'ProjectRootNodeShell'),
    patternToolbox: shell(PatternToolboxNode, 'PatternToolboxNodeShell'),
    pattern: shell(PatternNode, 'PatternNodeShell'),
    constraintDashboard: shell(ConstraintDashboardNode, 'ConstraintDashboardNodeShell'),
    schema: shell(SchemaNode, 'SchemaNodeShell'),
    sourcePreview: shell(SourcePreviewNode, 'SourcePreviewNodeShell'),
    jsonSourcePreview: shell(JsonSourcePreviewNode, 'JsonSourcePreviewNodeShell'),
    jsonSchema: shell(JsonSchemaNode, 'JsonSchemaNodeShell'),
    regex: shell(RegexNode, 'RegexNodeShell'),
    regexExtract: shell(RegexNode, 'RegexNodeShellExtract'),
    transform: shell(TransformNode, 'TransformNodeShell'),
    transformOutput: shell(TransformOutputNode, 'TransformOutputNodeShell'),
    manualData: shell(ManualDataNode, 'ManualDataNodeShell'),
    templateInstance: shell(TemplateInstanceNode, 'TemplateInstanceNodeShell'),
  }

  // 约束节点：遍历注册表，画布 key 统一为 `${kind}Constraint`。
  // 约束组件在 registerConstraintNodeLibrary 内已 markRaw。
  for (const [kind, reg] of Object.entries(constraintNodeRegistry)) {
    if (reg?.component) {
      nodeTypes[`${kind}Constraint`] = shell(reg.component, `${kind}ConstraintShell`)
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
