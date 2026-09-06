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
 * @file useCanvasNodeOperations.dragPosition.test.ts
 * @description hasNodePositionMoved 纯函数单测（S3 拖拽位移增量判定）
 */
import { describe, expect, it } from 'vitest'
import type { NodeDragEvent } from '@vue-flow/core'
import { hasNodePositionMoved } from '@/composables/canvas/useCanvasNodeOperations'

type SnapNode = { id: string; position: { x: number; y: number } }

const makeGraphNode = (id: string, x: number, y: number) =>
  ({ id, position: { x, y } }) as unknown as NodeDragEvent['nodes'][number]

describe('hasNodePositionMoved', () => {
  const startPositions = new Map([
    ['a', { x: 10, y: 20 }],
    ['b', { x: 0, y: 0 }],
  ])
  const snapshotNodes: SnapNode[] = [
    { id: 'a', position: { x: 10, y: 20 } },
    { id: 'b', position: { x: 0, y: 0 } },
    { id: 'c', position: { x: 5, y: 5 } },
  ]

  it('全部节点位置未变 → false（不产生空撤销步）', () => {
    const dragStopNodes = [makeGraphNode('a', 10, 20), makeGraphNode('b', 0, 0)]
    expect(hasNodePositionMoved(startPositions, snapshotNodes, dragStopNodes)).toBe(false)
  })

  it('任一被拖节点位置变化 → true', () => {
    const dragStopNodes = [makeGraphNode('a', 10, 20), makeGraphNode('b', 3, 0)]
    expect(hasNodePositionMoved(startPositions, snapshotNodes, dragStopNodes)).toBe(true)
  })

  it('多选拖拽中一个动了即 true，其余未动不影响', () => {
    const dragStopNodes = [makeGraphNode('a', 42, 20), makeGraphNode('b', 0, 0)]
    expect(hasNodePositionMoved(startPositions, snapshotNodes, dragStopNodes)).toBe(true)
  })

  it('起始记录缺失的节点 → 保守视为移动（入栈不丢步）', () => {
    const dragStopNodes = [makeGraphNode('unknown', 1, 1)]
    expect(hasNodePositionMoved(startPositions, snapshotNodes, dragStopNodes)).toBe(true)
  })

  it('快照中无该节点时回退用起始位置作基准', () => {
    const dragStopNodes = [makeGraphNode('a', 10, 20)]
    expect(hasNodePositionMoved(startPositions, [], dragStopNodes)).toBe(false)
  })
})
