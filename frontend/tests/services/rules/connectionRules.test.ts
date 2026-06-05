/**
 * @file connectionRules.test.ts
 * @description 连接规则注册表完整性自检
 *
 * 职责范围（与 registryIntegrity.test.ts 互补）：
 * - 验证 connectionRules 数组本身的数据完整性
 * - 检查每条规则的 id 唯一性
 * - 检查每条规则的 source/target 端点字段合法性
 * - 检查 schema-to-constraint 这条最关键的规则覆盖了所有 10 种约束类型
 *
 * 这是 AGENTS.md 强调的 "任何进入 store.edges 的连接都必须先在 connectionRules 中
 * 定义" 原则的最低保障测试。
 */

import { describe, it, expect } from 'vitest'
import { connectionRules } from '@/services/rules/connectionRules'
import { CONSTRAINT_TYPES, kindToMeta } from '@/services/constraints/validationRegistryCore'
import { isConstraintNodeType, type NodeType } from '@/services/rules/connectionRuleTypes'

const ALL_CONSTRAINT_NODE_TYPES: string[] = CONSTRAINT_TYPES.map((m) => m.nodeType)

describe('connectionRules 注册表完整性', () => {
  it('规则数组非空', () => {
    expect(connectionRules.length).toBeGreaterThan(0)
  })

  it('每条规则都有唯一 id', () => {
    const ids = connectionRules.map((r) => r.id)
    const unique = new Set(ids)
    expect(unique.size).toBe(ids.length)
  })

  it('每条规则 id 字符串非空', () => {
    for (const rule of connectionRules) {
      expect(rule.id, `rule with empty id: ${rule.name}`).toBeTruthy()
      expect(typeof rule.id).toBe('string')
    }
  })

  it('每条规则都有 name 字符串', () => {
    for (const rule of connectionRules) {
      expect(rule.name).toBeTruthy()
      expect(typeof rule.name).toBe('string')
    }
  })

  it('每条规则 source 至少有一个 nodeType', () => {
    for (const rule of connectionRules) {
      expect(Array.isArray(rule.source.nodeTypes)).toBe(true)
      expect(rule.source.nodeTypes.length).toBeGreaterThan(0)
    }
  })

  it('每条规则 target 至少有一个 nodeType', () => {
    for (const rule of connectionRules) {
      expect(Array.isArray(rule.target.nodeTypes)).toBe(true)
      expect(rule.target.nodeTypes.length).toBeGreaterThan(0)
    }
  })

  it('每条规则 handles 字段为 string[] 或 undefined', () => {
    for (const rule of connectionRules) {
      if (rule.source.handles !== undefined) {
        expect(Array.isArray(rule.source.handles)).toBe(true)
        for (const h of rule.source.handles) {
          expect(typeof h).toBe('string')
          expect(h.length).toBeGreaterThan(0)
        }
      }
      if (rule.target.handles !== undefined) {
        expect(Array.isArray(rule.target.handles)).toBe(true)
        for (const h of rule.target.handles) {
          expect(typeof h).toBe('string')
          expect(h.length).toBeGreaterThan(0)
        }
      }
    }
  })

  it('每条规则 config.validationMode 是 strict 或 loose（如指定）', () => {
    for (const rule of connectionRules) {
      if (rule.config?.validationMode !== undefined) {
        expect(['strict', 'loose']).toContain(rule.config.validationMode)
      }
    }
  })

  it('schema-to-constraint 覆盖所有 10 种约束类型作为 target', () => {
    const rule = connectionRules.find((r) => r.id === 'schema-to-constraint')
    expect(rule, 'schema-to-constraint rule must exist').toBeDefined()

    const targetNodeTypes = new Set<string>(rule!.target.nodeTypes)
    for (const expected of ALL_CONSTRAINT_NODE_TYPES) {
      expect(
        targetNodeTypes.has(expected),
        `schema-to-constraint rule should allow ${expected} as target`
      ).toBe(true)
    }
  })

  it('每条 target 引用约束 nodeType 的规则，其 nodeType 都来自 CONSTRAINT_TYPES', () => {
    const declared = new Set(ALL_CONSTRAINT_NODE_TYPES)

    for (const rule of connectionRules) {
      for (const nt of rule.target.nodeTypes) {
        if (isConstraintNodeType(nt as NodeType)) {
          expect(
            declared.has(nt),
            `Rule "${rule.id}" target references constraint nodeType "${nt}" which is not in CONSTRAINT_TYPES`
          ).toBe(true)
        }
      }
    }
  })

  it('kindToMeta 注册表覆盖所有 connectionRules 引用的约束 kind', () => {
    // 验证反向一致性：每个约束 nodeType 都对应一个 kind，且 kind 在 kindToMeta 中
    for (const meta of CONSTRAINT_TYPES) {
      expect(kindToMeta.has(meta.kind as never), `kind "${meta.kind}" not in kindToMeta`).toBe(true)
    }
  })

  it('schema-to-regex 同时支持 schema 和 jsonSchema 作为 source', () => {
    const rule = connectionRules.find((r) => r.id === 'schema-to-regex')
    expect(rule).toBeDefined()
    expect(rule!.source.nodeTypes).toContain('schema')
    expect(rule!.source.nodeTypes).toContain('jsonSchema')
  })

  it('json-source-to-schema 与 source-to-schema 是不同规则（避免误合并）', () => {
    const csv = connectionRules.find((r) => r.id === 'source-to-schema')
    const json = connectionRules.find((r) => r.id === 'json-source-to-schema')
    expect(csv).toBeDefined()
    expect(json).toBeDefined()
    expect(csv).not.toBe(json)
  })
})
