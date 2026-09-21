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
import type { CustomNode } from '@/types/graph'
import {
  buildSubConstraintParams,
  compositeBuilder,
} from '@/services/persistence/builders/constraint/composite'
import { buildForeignKeyRefs } from '@/services/persistence/builders/constraint/helpers'

function makeNode(id: string, type: string, data: Record<string, unknown>): CustomNode {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data,
  } as unknown as CustomNode
}

describe('buildSubConstraintParams - ForeignKey（confirmed #2）', () => {
  it('allowNull=true 时产出 allow_null: true', () => {
    expect(buildSubConstraintParams({ allowNull: true }, 'ForeignKey')).toEqual({
      allow_null: true,
    })
  })

  it('allowNull 缺省时不写 allow_null（与独立 FK builder 同口径）', () => {
    expect(buildSubConstraintParams({}, 'ForeignKey')).toEqual({})
    expect(buildSubConstraintParams({ allowNull: false }, 'ForeignKey')).toEqual({})
  })
})

describe('buildForeignKeyRefs（confirmed #2 共享事实源）', () => {
  it('sourceRef/targetRef 齐全时产出 from/to 四元 refs', () => {
    expect(
      buildForeignKeyRefs(
        {
          sourceRef: { nodeId: 'node-a', columnId: 'col-from' },
          targetRef: { nodeId: 'node-b', columnId: 'col-to' },
        },
        { 'node-a': 'schema-a', 'node-b': 'schema-b' }
      )
    ).toEqual({
      from_table_id: 'schema-a',
      from_column_id: 'col-from',
      to_table_id: 'schema-b',
      to_column_id: 'col-to',
    })
  })

  it('引用不完整时返回空 refs（不产出半截双引用）', () => {
    expect(buildForeignKeyRefs({ sourceRef: { nodeId: 'a', columnId: 'c' } }, {})).toEqual({})
  })
})

describe('compositeBuilder - FK 子约束（confirmed #2）', () => {
  it('FK 子约束的 refs 为 from/to 双引用、params 携带 allow_null', () => {
    const composite = makeNode('comp-1', 'compositeConstraint', {
      includedNodeIds: ['fk-1'],
      sourceRef: { nodeId: 'schema-a', columnId: 'col-x' },
    })
    const fkSub = makeNode('fk-1', 'foreignKeyConstraint', {
      allowNull: true,
      sourceRef: { nodeId: 'schema-a', columnId: 'col-x' },
      targetRef: { nodeId: 'schema-b', columnId: 'col-y' },
    })

    const { file } = compositeBuilder.build({
      node: composite,
      nodes: [composite, fkSub],
      edges: [],
      schemaIdByNodeId: {},
    })

    const sub = (file.params.sub_constraints as Array<Record<string, unknown>>)[0]
    expect(sub.type).toBe('ForeignKey')
    expect(sub.params).toEqual({ allow_null: true })
    expect(sub.refs).toEqual({
      from_table_id: 'schema-a',
      from_column_id: 'col-x',
      to_table_id: 'schema-b',
      to_column_id: 'col-y',
    })
  })

  it('非 FK 子约束仍走单列 refs（不回归）', () => {
    const composite = makeNode('comp-2', 'compositeConstraint', {
      includedNodeIds: ['nn-1'],
      sourceRef: { nodeId: 'schema-a', columnId: 'col-x' },
    })
    const nnSub = makeNode('nn-1', 'notNullConstraint', {
      sourceRef: { nodeId: 'schema-a', columnId: 'col-x' },
    })

    const { file } = compositeBuilder.build({
      node: composite,
      nodes: [composite, nnSub],
      edges: [],
      schemaIdByNodeId: {},
    })

    const sub = (file.params.sub_constraints as Array<Record<string, unknown>>)[0]
    expect(sub.type).toBe('NotNull')
    expect(sub.refs).toEqual({ table_id: 'schema-a', column_id: 'col-x' })
  })
})
