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
import { describe, it, expect, vi } from 'vitest'
import { createMiscFactoryModule } from '@/stores/graphStore/modules/factories/miscFactory'

describe('miscFactory', () => {
  const mockCreateSchemaNode = vi.fn(() => 'schema-id')
  const mockCreateRegexNode = vi.fn(() => 'regex-id')
  const mockCreateConstraintNode = vi.fn(() => 'constraint-id')

  const factory = createMiscFactoryModule({
    createSchemaNode: mockCreateSchemaNode,
    createRegexNode: mockCreateRegexNode,
    createConstraintNode: mockCreateConstraintNode,
  })

  beforeEach(() => {
    mockCreateSchemaNode.mockClear()
    mockCreateRegexNode.mockClear()
    mockCreateConstraintNode.mockClear()
  })

  describe('createEmptyTableNode', () => {
    it('委托给 createSchemaNode 并返回 id', () => {
      const id = factory.createEmptyTableNode({ x: 10, y: 20 }, 'MyTable')
      expect(id).toBe('schema-id')
      expect(mockCreateSchemaNode).toHaveBeenCalledWith({ x: 10, y: 20 }, 'MyTable')
    })

    it('使用默认名称', () => {
      factory.createEmptyTableNode({ x: 0, y: 0 })
      expect(mockCreateSchemaNode).toHaveBeenCalledWith({ x: 0, y: 0 }, '新表格')
    })
  })

  describe('createEmptyPatternNode', () => {
    it('委托给 createRegexNode 并返回 id', () => {
      const id = factory.createEmptyPatternNode({ x: 10, y: 20 }, 'MyPattern')
      expect(id).toBe('regex-id')
      expect(mockCreateRegexNode).toHaveBeenCalledWith({ x: 10, y: 20 }, '', 'MyPattern')
    })

    it('使用默认名称', () => {
      factory.createEmptyPatternNode({ x: 0, y: 0 })
      expect(mockCreateRegexNode).toHaveBeenCalledWith({ x: 0, y: 0 }, '', '新模式')
    })
  })

  describe('createLogicNode', () => {
    it('委托给 createConstraintNode 并返回 id', () => {
      const id = factory.createLogicNode({ x: 10, y: 20 }, 'MyLogic')
      expect(id).toBe('constraint-id')
      expect(mockCreateConstraintNode).toHaveBeenCalledWith({ x: 10, y: 20 }, 'foreignKey', {
        configName: 'MyLogic',
      })
    })

    it('使用默认名称', () => {
      factory.createLogicNode({ x: 0, y: 0 })
      expect(mockCreateConstraintNode).toHaveBeenCalledWith({ x: 0, y: 0 }, 'foreignKey', {
        configName: '新逻辑约束',
      })
    })
  })
})
