/**
 * X01 — Precision 约束前端注册链路测试（真实仓库）。
 *
 * 覆盖：三层命名元数据、三向映射、节点数据构建器、校验处理器注册与本地执行、
 * 节点数据接口引用、双侧 i18n。
 * 本文件由 verify.py 复制到 frontend/tests/test_x01_precision.test.ts 运行。
 */
import { describe, it, expect } from 'vitest'
import {
  CONSTRAINT_TYPES,
  kindToMeta,
  typeToMeta,
  handlers,
  getHandlerByKind,
  getConstraintKindByV2Type,
  getConstraintNodeTypeByV2Type,
  getV2TypeByConstraintKind,
  isConstraintNodeType,
  getConstraintKindByNodeType,
  requiresInputHandle,
} from '@/services/constraints/validationRegistryCore'
import '@/services/constraints/nodeDataBuilder'
import { buildNodeData } from '@/services/constraints/nodeDataBuilder/registry'
// 显式触发 handler 自注册（side-effect barrel import）：
// 处理器经 validationRegistryHandlers/index.ts 的 side-effect import 调用 register()，
// 只导入 validationRegistryCore 不会加载 handler 文件本身。
import '@/services/constraints/validationRegistryHandlers'
import type { ConstraintValidationContext } from '@/services/constraints/types'
import { constraintTypes as zhConstraintTypes } from '@/i18n/locales/zh-CN/constraints'
import { constraintTypes as enConstraintTypes } from '@/i18n/locales/en-US/constraints'

// ============================================================================
// 1. 约束元数据：CONSTRAINT_TYPES 含 precision，三层命名对齐
// ============================================================================

describe('X01 precision - 约束元数据', () => {
  it('CONSTRAINT_TYPES 含 11 种约束（precision 为第 11 种）', () => {
    expect(CONSTRAINT_TYPES).toHaveLength(11)
  })

  it('precision 元数据存在且三层命名正确', () => {
    const meta = CONSTRAINT_TYPES.find((m) => m.kind === 'precision')
    expect(meta).toBeDefined()
    expect(meta!.nodeType).toBe('precisionConstraint')
    expect(meta!.v2Type).toBe('Precision')
  })

  it('kindToMeta / typeToMeta 可命中 precision', () => {
    expect(kindToMeta.has('precision')).toBe(true)
    expect(typeToMeta.has('precisionConstraint')).toBe(true)
  })

  it('三向映射查询一致', () => {
    expect(getConstraintKindByV2Type('Precision')).toBe('precision')
    expect(getConstraintNodeTypeByV2Type('Precision')).toBe('precisionConstraint')
    expect(getV2TypeByConstraintKind('precision')).toBe('Precision')
  })

  it('节点类型识别：precisionConstraint 是合法约束节点类型', () => {
    expect(isConstraintNodeType('precisionConstraint')).toBe(true)
    expect(getConstraintKindByNodeType('precisionConstraint')).toBe('precision')
  })

  it('precision 需要输入连接（单列输入，与 range 一致）', () => {
    expect(requiresInputHandle('precisionConstraint')).toBe(true)
  })
})

// ============================================================================
// 2. 校验处理器：注册 + 行内数据本地执行
// ============================================================================

describe('X01 precision - 校验处理器', () => {
  it('kind precision 已在 handlers 注册，含 validate 与 resetOnDisconnect', () => {
    expect(handlers.has('precision')).toBe(true)
    const handler = getHandlerByKind('precision')
    expect(handler).toBeTruthy()
    expect(handler!.kind).toBe('precision')
    expect(typeof handler!.validate).toBe('function')
    expect(typeof handler!.resetOnDisconnect).toBe('function')
  })

  it('行内数据本地校验：小数超限与非数值各记违规', async () => {
    const handler = getHandlerByKind('precision')
    expect(handler).toBeTruthy()
    if (!handler) return

    const ctx = {
      constraintNode: { id: 'c1', type: 'precisionConstraint', data: { precision: 2 } },
      columnName: 'amount',
      inlineColumnNames: ['amount'],
      inlineRows: [['1.23'], ['1.234'], ['abc']],
    } as unknown as ConstraintValidationContext

    const result = await handler.validate(ctx)
    expect(result.status).toBe('error')
    expect(result.lastValidation?.totalRows).toBe(3)
    expect(result.lastValidation?.errorCount).toBe(2)
    expect(result.lastValidation?.matchCount).toBe(1)
    expect(result.validationErrors.length).toBeGreaterThan(0)
  })

  it('行内数据全部合规 → pass', async () => {
    const handler = getHandlerByKind('precision')
    expect(handler).toBeTruthy()
    if (!handler) return

    const ctx = {
      constraintNode: { id: 'c1', type: 'precisionConstraint', data: { precision: 2 } },
      columnName: 'amount',
      inlineColumnNames: ['amount'],
      inlineRows: [['1.23'], ['2'], ['0.5']],
    } as unknown as ConstraintValidationContext

    const result = await handler.validate(ctx)
    expect(result.status).toBe('pass')
    expect(result.lastValidation?.errorCount).toBe(0)
  })

  it('precision=0 时任何小数都是违规', async () => {
    const handler = getHandlerByKind('precision')
    expect(handler).toBeTruthy()
    if (!handler) return

    const ctx = {
      constraintNode: { id: 'c1', type: 'precisionConstraint', data: { precision: 0 } },
      columnName: 'amount',
      inlineColumnNames: ['amount'],
      inlineRows: [['1.5'], ['3']],
    } as unknown as ConstraintValidationContext

    const result = await handler.validate(ctx)
    expect(result.status).toBe('error')
    expect(result.lastValidation?.errorCount).toBe(1)
  })

  it('无行内数据且无数据源 → 数据源防护返回 idle', async () => {
    const handler = getHandlerByKind('precision')
    expect(handler).toBeTruthy()
    if (!handler) return

    const ctx = {
      constraintNode: { id: 'c1', type: 'precisionConstraint', data: { precision: 2 } },
      columnName: 'amount',
    } as unknown as ConstraintValidationContext

    const result = await handler.validate(ctx)
    expect(result.status).toBe('idle')
  })
})

// ============================================================================
// 3. 节点数据构建器
// ============================================================================

describe('X01 precision - 节点数据构建器', () => {
  it("buildNodeData('precision', ...) 产出含 table/column/precision 的节点数据", () => {
    const result = buildNodeData('precision', {
      nodeId: 'p1',
      nodeType: 'precisionConstraint',
      configName: 'amount-precision',
      mode: 'import',
      schemaNodeId: 's1',
      tableName: 'users',
      sourceData: {},
      columnRef: { nodeId: 's1', columnId: 'col-amount', columnName: 'amount' },
      params: { precision: 3 },
    })

    const data = result.nodeData as Record<string, unknown>
    expect(data.table).toBe('users')
    expect(data.column).toBe('amount')
    expect(data.precision).toBe(3)
    expect(result.edgeDescriptors).toHaveLength(1)
    expect(result.edgeDescriptors[0]?.columnId).toBe('col-amount')
  })
})

// ============================================================================
// 4. 双侧 i18n
// ============================================================================

describe('X01 precision - 双侧 i18n', () => {
  it('zh-CN 含 precision 条目（name/description 非空）', () => {
    const entry = (zhConstraintTypes as Record<string, { name: string; description: string } | undefined>)
      .precision
    expect(entry).toBeDefined()
    expect(entry!.name).toBeTruthy()
    expect(entry!.description).toBeTruthy()
  })

  it('en-US 含 precision 条目（name/description 非空）', () => {
    const entry = (enConstraintTypes as Record<string, { name: string; description: string } | undefined>)
      .precision
    expect(entry).toBeDefined()
    expect(entry!.name).toBeTruthy()
    expect(entry!.description).toBeTruthy()
  })

  it('双侧名称不同（各自真实文案，非空壳复制）', () => {
    const zh = (zhConstraintTypes as Record<string, { name: string } | undefined>).precision
    const en = (enConstraintTypes as Record<string, { name: string } | undefined>).precision
    expect(zh).toBeDefined()
    expect(en).toBeDefined()
    expect(zh!.name).not.toBe(en!.name)
  })
})
