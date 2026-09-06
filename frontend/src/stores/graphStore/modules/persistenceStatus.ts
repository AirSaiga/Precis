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
 * @file persistenceStatus.ts
 * @description 节点保存状态查询模块
 *
 * 包含:
 * - hasUnsavedChanges: 是否有任何节点处于 draft 状态
 * - getSaveStatusSummary: 统计 schema/transform 的已保存与未保存数量
 */

import type { Ref } from 'vue'
import type { CustomNode, SchemaNodeData } from '@/types/graph'
import { isRegexNodeType } from '@/utils/nodes/regex'

export interface PersistenceStatusDeps {
  nodes: Ref<CustomNode[]>
  isConstraintNodeType: (type: string | undefined) => boolean
}

export function createPersistenceStatusModule(deps: PersistenceStatusDeps) {
  const { nodes, isConstraintNodeType } = deps

  function hasUnsavedChanges(): boolean {
    return nodes.value.some((node) => {
      const data = node.data as unknown as Record<string, unknown>
      if (data._expandedFromInstanceId) return false

      if (node.type === 'schema' || node.type === 'jsonSchema') {
        const schemaData = node.data as SchemaNodeData
        return schemaData.saveState === 'draft'
      }
      if (isConstraintNodeType(node.type)) {
        return data?.saveState === 'draft'
      }
      if (isRegexNodeType(node.type)) {
        return data?.saveState === 'draft'
      }
      if (node.type === 'transform') {
        return data?.saveState === 'draft'
      }
      if (node.type === 'templateInstance') {
        return data?.saveState === 'draft'
      }
      // manualData 节点可持久化（planBuilder 收集、全量保存落盘），
      // draft 状态必须计入未保存变更——否则新建手动数据节点不亮未保存标记，
      // 用户无从知晓数据未落盘
      if (node.type === 'manualData') {
        return data?.saveState === 'draft'
      }
      return false
    })
  }

  function getSaveStatusSummary() {
    const totalSchemas = nodes.value.filter((n) => n.type === 'schema').length
    const savedSchemas = nodes.value.filter((n) => {
      if (n.type === 'schema') {
        const schemaData = n.data as SchemaNodeData
        return schemaData.saveState === 'saved'
      }
      return false
    }).length

    const totalTransforms = nodes.value.filter((n) => n.type === 'transform').length
    const savedTransforms = nodes.value.filter((n) => {
      if (n.type === 'transform') {
        return (n.data as unknown as Record<string, unknown>)?.saveState === 'saved'
      }
      return false
    }).length

    return {
      total: totalSchemas + totalTransforms,
      saved: savedSchemas + savedTransforms,
      unsaved: totalSchemas - savedSchemas + totalTransforms - savedTransforms,
      hasChanges: hasUnsavedChanges(),
    }
  }

  return {
    hasUnsavedChanges,
    getSaveStatusSummary,
  }
}
