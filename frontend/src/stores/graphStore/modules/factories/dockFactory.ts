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
 * @fileoverview 约束坞节点工厂 —— 为 Schema 创建幂等的派生坞节点
 *
 * 坞是纯 UI 派生节点（先例 patternToolbox / constraintDashboard）：
 * 仅一个视觉隐藏的展示边 target handle（ConstraintDockNode 内 target-dock，
 * 承接 dockSync 创建的 schema-to-dock-display 边），无数据 Handle、
 * 无 builder/manifest/YAML，saveState 恒 'saved'。
 * 节点 id 确定性派生 `constraint-dock-{schemaNodeId}`，幂等 find 用；
 * draggable:false 防与 Schema 脱钩，selectable:false 防剪贴板克隆孤儿坞。
 *
 * 职责边界：本工厂只负责"存在性"（建 or 找到即返回），
 * rows / position / hidden / expandedAll 的增量同步由 dockSync 同步器驱动。
 */

import { nextTick, type Ref } from 'vue'
import type { CustomNode, ConstraintDockNodeData, ConstraintDockRow } from '@/types/graph'
import { addNodes, VueFlowApiNotInitializedError } from '@/services/canvas/vueFlowApi'

/** 约束坞节点 id：由宿主 Schema 节点 id 确定性派生（幂等查找与级联删除依赖） */
export function constraintDockNodeId(schemaNodeId: string): string {
  return `constraint-dock-${schemaNodeId}`
}

export interface EnsureConstraintDockInput {
  schemaNodeId: string
  /** 坞标题展示的宿主 Schema 显示名 */
  configName: string
  /** 初始行快照（按 Schema 列序） */
  rows: ConstraintDockRow[]
  /** 建坞落点（Schema 右侧） */
  position: { x: number; y: number }
}

export function createDockFactoryModule(params: { nodes: Ref<CustomNode[]> }) {
  const { nodes } = params

  /**
   * 幂等创建约束坞：确定性 id 已存在则直接返回，不重建、不重置 expanded。
   * addNodes 后 await nextTick（幂等创建纪律：等 v-model model→store 回写，
   * 本 tick 后续 find 即可命中）。
   */
  async function ensureConstraintDockForSchema(input: EnsureConstraintDockInput): Promise<string> {
    const id = constraintDockNodeId(input.schemaNodeId)
    if (nodes.value.some((n) => n.id === id)) return id

    const data: ConstraintDockNodeData = {
      configName: input.configName,
      schemaNodeId: input.schemaNodeId,
      expanded: false,
      expandedAll: false,
      rows: input.rows,
      saveState: 'saved',
    }

    const node: CustomNode = {
      id,
      type: 'constraintDock',
      position: { ...input.position },
      draggable: false,
      selectable: false,
      data,
    }

    try {
      addNodes(node)
    } catch (error) {
      if (error instanceof VueFlowApiNotInitializedError) {
        // 画布未挂载（IDE↔Agent 切换窗口期 / 无头上下文）：
        // 走全量数组替换兜底（节点全量替换不触发 hooks、不丢边），
        // 画布挂载后 v-model 以 store 数组初始化，坞自然出现。
        nodes.value = [...nodes.value, node]
        return id
      }
      throw error
    }

    await nextTick()
    return id
  }

  return {
    ensureConstraintDockForSchema,
  }
}
