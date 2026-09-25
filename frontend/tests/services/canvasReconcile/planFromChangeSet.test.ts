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
 * @fileoverview planFromChangeSet 单元测试：去重/折叠/保序全分支
 */
import { describe, it, expect } from 'vitest'
import { planFromChangeSet } from '@/services/canvasReconcile/planFromChangeSet'
import type { ChangeSetEnvelope } from '@/services/canvasReconcile/envelope'

function makeEnvelope(overrides: Partial<ChangeSetEnvelope> = {}): ChangeSetEnvelope {
  const op = overrides.op ?? 'add'
  const kind = overrides.kind ?? 'schema'
  const entityId = overrides.entityId ?? 'users'
  return {
    instructionId: overrides.instructionId ?? `${op}:${kind}:${entityId}`,
    actionType: overrides.actionType ?? 'ADD_SCHEMA',
    op,
    kind,
    entityId,
    filePath: overrides.filePath ?? `${kind}s/${entityId}.yaml`,
  }
}

describe('planFromChangeSet', () => {
  it('空列表产出空计划', () => {
    expect(planFromChangeSet([]).ops).toEqual([])
  })

  it('单条 add 产出一条 rebuild', () => {
    const plan = planFromChangeSet([makeEnvelope()])
    expect(plan.ops).toEqual([
      {
        instructionId: 'add:schema:users',
        op: 'rebuild',
        kind: 'schema',
        entityId: 'users',
        filePath: 'schemas/users.yaml',
      },
    ])
  })

  it('单条 remove 产出一条 remove', () => {
    const plan = planFromChangeSet([
      makeEnvelope({ op: 'remove', entityId: 'c1', kind: 'constraint' }),
    ])
    expect(plan.ops[0]).toMatchObject({ op: 'remove', entityId: 'c1', kind: 'constraint' })
  })

  it('同 instructionId 重复送达只保留末见（EventJournal 重放/快照兜底）', () => {
    const first = makeEnvelope()
    const replay = makeEnvelope() // 完全相同（信封确定性 → 同 id 同内容）
    const plan = planFromChangeSet([first, replay])
    expect(plan.ops).toHaveLength(1)
  })

  it('末见去重：[add, remove, add 同 id] 终态为重建（首见去重会错误终态为已删）', () => {
    const add1 = makeEnvelope({ entityId: 'users' })
    const remove = makeEnvelope({ op: 'remove', entityId: 'users' })
    const add2 = makeEnvelope({ entityId: 'users' }) // 同 instructionId，磁盘重建后的新变更
    const plan = planFromChangeSet([add1, remove, add2])
    // add1 被末见的 add2 取代（位置随之移到末尾）：[remove, rebuild]
    expect(plan.ops).toHaveLength(2)
    expect(plan.ops[0]).toMatchObject({ op: 'remove', entityId: 'users' })
    expect(plan.ops[1]).toMatchObject({ op: 'rebuild', entityId: 'users' })
  })

  it('同实体 add + update 折叠为一次 rebuild（落在最后一次出现位置）', () => {
    const add = makeEnvelope({ entityId: 'users' }) // add:schema:users
    const update = makeEnvelope({ op: 'update', entityId: 'users' }) // update:schema:users
    const other = makeEnvelope({ entityId: 'orders', kind: 'schema' })

    const plan = planFromChangeSet([add, other, update])
    // add 与 update 折叠；位置在 update（最后一次出现），other 保序在前
    expect(plan.ops).toHaveLength(2)
    expect(plan.ops[0]).toMatchObject({ entityId: 'orders', op: 'rebuild' })
    expect(plan.ops[1]).toMatchObject({ entityId: 'users', op: 'rebuild' })
  })

  it('同实体 remove → add 不折叠：时间序保留两个真实变更', () => {
    const remove = makeEnvelope({ op: 'remove', entityId: 'users' })
    const add = makeEnvelope({ entityId: 'users' })
    const plan = planFromChangeSet([remove, add])
    expect(plan.ops).toHaveLength(2)
    expect(plan.ops[0].op).toBe('remove')
    expect(plan.ops[1].op).toBe('rebuild')
  })

  it('跨 remove 折叠安全：[add, remove, update] → [remove, rebuild]（删后重建语义）', () => {
    const add = makeEnvelope({ entityId: 'users' })
    const remove = makeEnvelope({ op: 'remove', entityId: 'users' })
    const update = makeEnvelope({ op: 'update', entityId: 'users' })
    const plan = planFromChangeSet([add, remove, update])
    expect(plan.ops).toHaveLength(2)
    expect(plan.ops[0].op).toBe('remove')
    expect(plan.ops[1].op).toBe('rebuild')
  })

  it('输入时间序跨实体保序（不做 add 先于 remove 的全局重排）', () => {
    const ops = [
      makeEnvelope({ op: 'remove', entityId: 'a', kind: 'regex' }),
      makeEnvelope({ entityId: 'b', kind: 'constraint' }),
      makeEnvelope({ op: 'update', entityId: 'c', kind: 'transform' }),
    ]
    const plan = planFromChangeSet(ops)
    expect(plan.ops.map((o) => o.entityId)).toEqual(['a', 'b', 'c'])
    expect(plan.ops.map((o) => o.op)).toEqual(['remove', 'rebuild', 'rebuild'])
  })

  it('instructionId 与实体解耦：不同实体同 op/kind 互不去重', () => {
    const plan = planFromChangeSet([
      makeEnvelope({ entityId: 'users' }),
      makeEnvelope({ entityId: 'orders' }),
    ])
    expect(plan.ops).toHaveLength(2)
  })

  it('同实体多条 update 折叠为一次 rebuild', () => {
    const u1 = makeEnvelope({ op: 'update', entityId: 'users' })
    const u2 = makeEnvelope({ op: 'update', entityId: 'users' })
    // 两条 update 的 instructionId 相同（确定性 id），先被 instructionId 末见去重收敛
    const plan = planFromChangeSet([u1, u2])
    expect(plan.ops).toHaveLength(1)
  })
})
