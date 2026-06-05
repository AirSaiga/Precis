/**
 * @fileoverview 约束注册表完整性自检测试
 *
 * 核心职责：
 * - 确保 CONSTRAIN_TYPES 中声明的每个约束类型都有对应的连接规则
 * - 确保每个约束 kind 都有对应的校验处理器（register）
 *
 * 这是防止 "compositeConstraint" 断裂类回归的最小化自动检查。
 *
 * Composite 约束已实现端到端链路。
 */

import { describe, it, expect } from 'vitest'
import { CONSTRAINT_TYPES, kindToMeta, handlers } from '@/services/constraints/validationRegistryCore'
import { connectionRules } from '@/services/rules/connectionRules'

/**
 * 已知未完整实现的约束类型白名单。
 *
 * 这些类型在 CONSTRAIN_TYPES / CONSTRAINT_TYPES 中有定义，
 * UI 组件和类型定义已存在，但连接规则或校验处理器暂未完成。
 * 回归测试允许它们暂时缺失，但会在控制台输出警告。
 */
const KNOWN_UNIMPLEMENTED_NODE_TYPES: string[] = []
const KNOWN_UNIMPLEMENTED_KINDS: string[] = []

describe('约束注册表完整性自检', () => {
  /**
   * 检查每个约束 nodeType 在 connectionRules 中至少作为一次 target
   *
   * 如果某个约束类型被声明在 CONSTRAINT_TYPES 中，但没有任何连接规则允许
   * 连线到它，说明连接规则与注册表不同步。
   */
  it('每个约束 nodeType 必须在 connectionRules 中有对应的 target 规则', () => {
    const targetNodeTypes = new Set<string>()
    for (const rule of connectionRules) {
      for (const nt of rule.target.nodeTypes) {
        targetNodeTypes.add(nt)
      }
    }

    const missing: string[] = []
    for (const meta of CONSTRAINT_TYPES) {
      if (!targetNodeTypes.has(meta.nodeType)) {
        missing.push(meta.nodeType)
      }
    }

    // 过滤已知未实现项，输出警告但不算失败
    const unexpected = missing.filter((m) => !KNOWN_UNIMPLEMENTED_NODE_TYPES.includes(m))
    const known = missing.filter((m) => KNOWN_UNIMPLEMENTED_NODE_TYPES.includes(m))
    if (known.length > 0) {
      console.warn(
        `[REGRESSION SKIP] 以下约束 nodeType 暂无连接规则（已知未实现）: ${known.join(', ')}`
      )
    }

    expect(unexpected).toEqual([])
  })

  /**
   * 检查每个约束 kind 都有对应的校验处理器
   *
   * validationRegistryHandlers.ts 中通过 register() 将处理器写入 handlers Map。
   * 如果某个 kind 没有处理器，画布触发校验时会报错 "未找到约束处理器"。
   */
  it('每个约束 kind 必须在 handlers 中注册了校验处理器', () => {
    const missing: string[] = []
    for (const meta of CONSTRAINT_TYPES) {
      if (!handlers.has(meta.kind)) {
        missing.push(meta.kind)
      }
    }

    // 过滤已知未实现项，输出警告但不算失败
    const unexpected = missing.filter((m) => !KNOWN_UNIMPLEMENTED_KINDS.includes(m))
    const known = missing.filter((m) => KNOWN_UNIMPLEMENTED_KINDS.includes(m))
    if (known.length > 0) {
      console.warn(
        `[REGRESSION SKIP] 以下约束 kind 暂无校验处理器（已知未实现）: ${known.join(', ')}`
      )
    }

    expect(unexpected).toEqual([])
  })

  /**
   * 反向检查：connectionRules 中的约束 target 必须在 CONSTRAINT_TYPES 中有定义
   *
   * 防止连接规则中引用了已删除或拼写错误的约束类型。
   */
  it('connectionRules 中的每个约束 target 必须在 CONSTRAINT_TYPES 中有定义', () => {
    const declaredNodeTypes = new Set(CONSTRAINT_TYPES.map((m) => m.nodeType))
    const invalid: Array<{ ruleId: string; nodeType: string }> = []

    for (const rule of connectionRules) {
      for (const nt of rule.target.nodeTypes) {
        if (isConstraintNodeType(nt) && !declaredNodeTypes.has(nt)) {
          invalid.push({ ruleId: rule.id, nodeType: nt })
        }
      }
    }

    expect(invalid).toEqual([])
  })
})

function isConstraintNodeType(type: string): boolean {
  return kindToMeta.has(type as never)
}

/**
 * 后端 CONSTRAINT_REGISTRY 中的 V2 约束类型名称（从 registry.py 提取）
 * 用于跨系统一致性校验：前端 V2Type 必须与后端注册表键完全对应
 */
const BACKEND_V2_TYPES = new Set([
  'NotNull',
  'Unique',
  'ForeignKey',
  'AllowedValues',
  'Range',
  'Conditional',
  'Scripted',
  'Charset',
  'DateLogic',
  'Composite',
])

describe('前后端约束命名一致性', () => {
  it('前端 CONSTRAINT_TYPES 的 v2Type 必须与后端 CONSTRAINT_REGISTRY 键一一对应', () => {
    const frontendV2Types = new Set(CONSTRAINT_TYPES.map((m) => m.v2Type))

    const missingInBackend = [...frontendV2Types].filter((t) => !BACKEND_V2_TYPES.has(t))
    const missingInFrontend = [...BACKEND_V2_TYPES].filter((t) => !frontendV2Types.has(t))

    expect(missingInBackend).toEqual([])
    expect(missingInFrontend).toEqual([])
  })

  it('前端 kind → v2Type 映射必须满足：kind 为 camelCase，v2Type 为 PascalCase', () => {
    for (const meta of CONSTRAINT_TYPES) {
      expect(meta.kind).toMatch(/^[a-z][a-zA-Z0-9]*$/)
      expect(meta.v2Type).toMatch(/^[A-Z][a-zA-Z0-9]*$/)
      expect(meta.nodeType).toMatch(/^[a-z][a-zA-Z0-9]*Constraint$/)
    }
  })

  it('每个 kind 必须有对应的 NodeDataBuilder', async () => {
    await import('@/services/constraints/nodeDataBuilder')
    const { buildNodeData } = await import('@/services/constraints/nodeDataBuilder/registry')
    const missing: string[] = []
    for (const meta of CONSTRAINT_TYPES) {
      const fkRefs = meta.kind === 'foreignKey'
        ? { source: { nodeId: 's1', columnId: 'c1', columnName: 'col' }, target: { nodeId: 's2', columnId: 'c2', columnName: 'col2' } }
        : undefined
      const result = buildNodeData(meta.kind, {
        nodeId: 'test-id',
        configName: 'test',
        mode: 'import',
        schemaNodeId: 'schema-id',
        sourceData: {},
        columnRef: { columnId: 'col-1', columnName: 'col' },
        tableName: 'testTable',
        fkRefs,
      })
      const data = result.nodeData as Record<string, unknown>
      if (meta.kind === 'foreignKey') {
        if (!('sourceTable' in data) && !('targetTable' in data)) {
          missing.push(meta.kind)
        }
      } else {
        if (!('table' in data) && !('column' in data)) {
          missing.push(meta.kind)
        }
      }
    }
    if (missing.length > 0) {
      console.log('Kinds without builder (using fallback):', missing)
    }
    expect(missing).toEqual([])
  })
})
