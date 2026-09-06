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
 * @fileoverview persistenceStatus 模块单元测试
 *
 * 回归锁（2026-09-03 GUI 覆盖测试发现）：
 * - hasUnsavedChanges 此前漏判 manualData 节点——新建手动数据节点不亮未保存
 *   标记，配合保存早退门造成"已保存"假阳性数据丢失
 * - _expandedFromInstanceId（模板展开预览节点）不计入未保存
 */

import { describe, it, expect } from 'vitest'
import { ref } from 'vue'
import type { CustomNode } from '@/types/graph'
import { createPersistenceStatusModule } from '@/stores/graphStore/modules/persistenceStatus'

function makeNode(id: string, type: string, data: Record<string, unknown>): CustomNode {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data,
  } as CustomNode
}

function createModule(nodes: CustomNode[]) {
  return createPersistenceStatusModule({
    nodes: ref(nodes),
    isConstraintNodeType: (t) => typeof t === 'string' && t.endsWith('Constraint'),
  })
}

describe('persistenceStatus - hasUnsavedChanges', () => {
  it('draft 手动数据节点计入未保存（manualData 漏判回归锁）', () => {
    const module = createModule([makeNode('md-1', 'manualData', { saveState: 'draft' })])
    expect(module.hasUnsavedChanges()).toBe(true)
  })

  it('已保存的手动数据节点不计入未保存', () => {
    const module = createModule([makeNode('md-1', 'manualData', { saveState: 'saved' })])
    expect(module.hasUnsavedChanges()).toBe(false)
  })

  it('draft schema / 约束 / transform / templateInstance 计入未保存', () => {
    const module = createModule([
      makeNode('s-1', 'schema', { saveState: 'draft' }),
      makeNode('c-1', 'notNullConstraint', { saveState: 'draft' }),
      makeNode('t-1', 'transform', { saveState: 'draft' }),
      makeNode('ti-1', 'templateInstance', { saveState: 'draft' }),
    ])
    expect(module.hasUnsavedChanges()).toBe(true)
  })

  it('全部节点已保存时不计入', () => {
    const module = createModule([
      makeNode('s-1', 'schema', { saveState: 'saved' }),
      makeNode('md-1', 'manualData', { saveState: 'saved' }),
      makeNode('c-1', 'notNullConstraint', { saveState: 'saved' }),
    ])
    expect(module.hasUnsavedChanges()).toBe(false)
  })

  it('模板展开预览节点（_expandedFromInstanceId）不计入未保存', () => {
    const module = createModule([
      makeNode('exp-1', 'notNullConstraint', {
        saveState: 'draft',
        _expandedFromInstanceId: 'instance-1',
      }),
    ])
    expect(module.hasUnsavedChanges()).toBe(false)
  })

  it('空画布不计入未保存', () => {
    const module = createModule([])
    expect(module.hasUnsavedChanges()).toBe(false)
  })
})
