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
import { describe, it, expect } from 'vitest'
import { buildV2ProjectView } from '@/services/builders/v2ProjectBuilder'
import type { CustomNode } from '@/types/graph'

function makeNode(overrides: Partial<CustomNode> & { id: string; type: string }): CustomNode {
  return {
    position: { x: 0, y: 0 },
    data: {},
    ...overrides,
  } as CustomNode
}

describe('buildV2ProjectView', () => {
  it('约束坞节点不写入 view（无死键）', () => {
    const nodes = [
      makeNode({ id: 'sc_users', type: 'schema', position: { x: 10, y: 20 } }),
      makeNode({
        id: 'constraint-dock-sc_users',
        type: 'constraintDock',
        position: { x: 430, y: 20 },
        hidden: true,
        data: { schemaNodeId: 'sc_users', rows: [], expanded: false },
      }),
      makeNode({
        id: 'c1',
        type: 'notNullConstraint',
        position: { x: 100, y: 300 },
        hidden: true,
      }),
    ]
    const view = buildV2ProjectView(nodes)

    expect(view.nodes).toEqual({ sc_users: { x: 10, y: 20 }, c1: { x: 100, y: 300 } })
    expect(Object.keys(view.nodes)).not.toContain('constraint-dock-sc_users')
    expect(view.nodeStates).toEqual({ c1: { hidden: true, expanded: false } })
  })

  it('无坞画布输出不受影响', () => {
    const view = buildV2ProjectView([
      makeNode({ id: 'sc1', type: 'schema', position: { x: 1, y: 2 } }),
    ])
    expect(view.nodes).toEqual({ sc1: { x: 1, y: 2 } })
    expect(view.nodeStates).toBeUndefined()
  })
})
