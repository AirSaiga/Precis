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
import type { ManualDataNodeData } from '@/types/nodes'
import { manualDataBuilder } from '@/services/persistence/builders/manualDataBuilder'

function makeManualDataNode(
  overrides: Partial<ManualDataNodeData> = {},
  nodeOverrides: Partial<CustomNode> = {}
): CustomNode {
  return {
    id: 'md-1',
    type: 'manualData',
    position: { x: 0, y: 0 },
    data: {
      configName: 'Test Data',
      columnName: 'age',
      columnDataType: 'Integer',
      rows: [['18'], ['25']],
      ...overrides,
    } as ManualDataNodeData,
    ...nodeOverrides,
  } as CustomNode
}

describe('manualDataBuilder', () => {
  it('匹配 manualData 节点', () => {
    const node = makeManualDataNode()
    expect(manualDataBuilder.matches(node)).toBe(true)
  })

  it('不匹配 schema 节点', () => {
    const node = makeManualDataNode({}, { type: 'schema' })
    expect(manualDataBuilder.matches(node)).toBe(false)
  })

  it('构建 ManualDataFileV2', () => {
    const node = makeManualDataNode()
    const result = manualDataBuilder.build({
      nodes: [],
      node,
      schemaIdByNodeId: {},
      configPath: '/tmp/proj',
    })

    expect(result.consumed).toBe(true)
    expect(result.file).toEqual({
      version: 2,
      id: 'md-1',
      column_name: 'age',
      column_data_type: 'integer',
      rows: [['18'], ['25']],
      enabled: true,
      description: 'Test Data',
    })
  })

  it('默认数据类型为 string', () => {
    const node = makeManualDataNode({ columnDataType: undefined })
    const result = manualDataBuilder.build({
      nodes: [],
      node,
      schemaIdByNodeId: {},
      configPath: '/tmp/proj',
    })

    expect(result.file.column_data_type).toBe('string')
  })

  it('禁用节点生成 enabled=false', () => {
    const node = makeManualDataNode({ enabled: false })
    const result = manualDataBuilder.build({
      nodes: [],
      node,
      schemaIdByNodeId: {},
      configPath: '/tmp/proj',
    })

    expect(result.file.enabled).toBe(false)
  })
})
