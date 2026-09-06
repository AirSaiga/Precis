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
import { hasBusinessNodes, shouldShowEmptyCanvasHint } from '@/utils/nodes/emptyCanvasHint'
import type { CustomNode } from '@/types/graph'

function makeNode(overrides?: Partial<CustomNode>): CustomNode {
  return {
    id: 'node-1',
    type: 'schema',
    position: { x: 0, y: 0 },
    data: { configName: 'Test' } as CustomNode['data'],
    ...overrides,
  } as CustomNode
}

describe('emptyCanvasHint', () => {
  describe('hasBusinessNodes', () => {
    it('空列表无业务节点', () => {
      expect(hasBusinessNodes([])).toBe(false)
    })

    it('仅项目根节点不算业务节点', () => {
      const nodes = [
        makeNode({ id: 'root', type: 'projectRoot' }),
        makeNode({ id: 'root-2', type: 'projectRoot' }),
      ]
      expect(hasBusinessNodes(nodes)).toBe(false)
    })

    it('出现任意业务节点即判定非空', () => {
      expect(hasBusinessNodes([makeNode({ id: 'schema', type: 'schema' })])).toBe(true)
      expect(hasBusinessNodes([makeNode({ id: 'src', type: 'sourcePreview' })])).toBe(true)
      expect(hasBusinessNodes([makeNode({ id: 'fk', type: 'foreignKeyConstraint' })])).toBe(true)
    })

    it('项目根与业务节点混存时判定非空', () => {
      const nodes = [
        makeNode({ id: 'root', type: 'projectRoot' }),
        makeNode({ id: 'schema', type: 'schema' }),
      ]
      expect(hasBusinessNodes(nodes)).toBe(true)
    })
  })

  describe('shouldShowEmptyCanvasHint', () => {
    it('全空或仅项目根时显示引导', () => {
      expect(shouldShowEmptyCanvasHint([])).toBe(true)
      expect(shouldShowEmptyCanvasHint([makeNode({ id: 'root', type: 'projectRoot' })])).toBe(true)
    })

    it('出现业务节点后隐藏引导', () => {
      expect(shouldShowEmptyCanvasHint([makeNode({ id: 'schema', type: 'schema' })])).toBe(false)
    })
  })
})
