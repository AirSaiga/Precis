/**
 * @file aiChatStore.test.ts
 * @description AI 聊天 Store 纯逻辑函数单元测试
 *
 * 仅测试模块级导出的纯函数（dedupeStreamedInstructions），不涉及 Pinia store 实例化
 * （Store 集成行为由 E2E 覆盖，符合"测行为不测实现 + composables/stores 走 E2E"策略）。
 */

import { describe, it, expect } from 'vitest'
import { dedupeStreamedInstructions } from '@/stores/aiChatStore'
import type { FrontendInstruction } from '@/stores/aiChatStore'

/** 工厂函数：构造约束指令 */
function makeConstraintInstruction(
  actionType = 'ADD_CONSTRAINT_NODE',
  type = 'NotNull',
  column = 'email'
): FrontendInstruction {
  return {
    actionType,
    constraintSpec: {
      type,
      targetNodeId: 'schema-users',
      tableName: 'users',
      targetColumn: column,
      constraintId: `c_${column}_${type}`,
      isInline: true,
    },
  }
}

/** 工厂函数：构造 schema 指令 */
function makeSchemaInstruction(name = 'users'): FrontendInstruction {
  return {
    actionType: 'ADD_SCHEMA',
    schemaSpec: { name },
  }
}

describe('dedupeStreamedInstructions', () => {
  it('streamed 为空时返回全部指令', () => {
    const all = [makeConstraintInstruction(), makeSchemaInstruction()]
    const result = dedupeStreamedInstructions(all, [])
    expect(result).toHaveLength(2)
  })

  it('剔除与 streamed 内容相同的指令（保留新增）', () => {
    const inst1 = makeConstraintInstruction('ADD_CONSTRAINT_NODE', 'NotNull', 'email')
    const inst2 = makeSchemaInstruction('orders')
    const inst3 = makeConstraintInstruction('ADD_CONSTRAINT_NODE', 'Unique', 'id')
    const all = [inst1, inst2, inst3]
    // 流式期间已实时应用了 inst1 和 inst3
    const streamed = [inst1, inst3]
    const result = dedupeStreamedInstructions(all, streamed)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual(inst2)
  })

  it('键顺序不同但内容相同的指令视为相等（稳定序列化）', () => {
    // 同一指令，键顺序不同——应识别为相等并去重
    const instA: FrontendInstruction = {
      actionType: 'ADD_SCHEMA',
      schemaSpec: { name: 'users', columns: [] },
    }
    const instB = {
      schemaSpec: { columns: [], name: 'users' }, // 键顺序颠倒
      actionType: 'ADD_SCHEMA',
    } as unknown as FrontendInstruction
    const result = dedupeStreamedInstructions([instA], [instB])
    expect(result).toHaveLength(0)
  })

  it('全部指令都已被流式应用时返回空数组', () => {
    const all = [makeConstraintInstruction(), makeSchemaInstruction()]
    const result = dedupeStreamedInstructions(all, [...all])
    expect(result).toHaveLength(0)
  })

  it('重复出现的全量指令各自去重（流式中只出现一次）', () => {
    const inst = makeConstraintInstruction()
    const all = [inst, inst]
    const streamed = [inst]
    const result = dedupeStreamedInstructions(all, streamed)
    expect(result).toHaveLength(0)
  })

  it('不修改输入数组（纯函数）', () => {
    const all = [makeConstraintInstruction()]
    const streamed = [makeConstraintInstruction()]
    const allSnapshot = JSON.parse(JSON.stringify(all))
    dedupeStreamedInstructions(all, streamed)
    expect(JSON.parse(JSON.stringify(all))).toEqual(allSnapshot)
  })
})
