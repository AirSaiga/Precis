/**
 * @fileoverview notNull / unique handler 文件路径模式测试
 *
 * 重点回归（假通过修复）：后端业务失败（HTTP 200 + success:false，如数据文件不存在）
 * 时必须返回 error 状态，而非落入"零错误=通过"判定。
 * inline 模式的 requestFailed 分责由各 handler 内联实现，此处仅覆盖文件路径模式。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Node, Edge } from '@vue-flow/core'
import { getHandlerByKind } from '@/services/constraints/validationRegistryCore'
import type { ConstraintValidationContext } from '@/services/constraints/types'

// 触发 handler 自注册（side-effect import）
import '@/services/constraints/validationRegistryHandlers/notNullHandler'
import '@/services/constraints/validationRegistryHandlers/uniqueHandler'

vi.mock('@/api/validationApi', () => ({
  validateNotNull: vi.fn(),
  validateUnique: vi.fn(),
  validateInline: vi.fn(),
}))

import {
  validateNotNull as apiValidateNotNull,
  validateUnique as apiValidateUnique,
} from '@/api/validationApi'

function makeNode(overrides: Partial<Node> = {}): Node {
  return {
    id: 'node-1',
    type: 'schema',
    position: { x: 0, y: 0 },
    data: {},
    ...overrides,
  } as Node
}

function makeEdge(overrides: Partial<Edge> = {}): Edge {
  return {
    id: 'edge-1',
    source: 'schema-1',
    target: 'constraint-1',
    sourceHandle: 'source-right-col-1',
    targetHandle: 'target-left',
    ...overrides,
  } as Edge
}

function makeFileModeCtx(): ConstraintValidationContext {
  return {
    nodes: [],
    schemaNode: makeNode({ id: 'schema-1' }),
    constraintNode: makeNode({ id: 'constraint-1', type: 'notNullConstraint' }),
    edge: makeEdge(),
    columnId: 'col-1',
    columnName: 'email',
    sourceFilePath: '/data/users.csv',
    sourceFile: 'users.csv',
    sheetName: 'Sheet1',
    headerRow: 0,
    // 文件路径模式：不提供 inlineRows
  } as unknown as ConstraintValidationContext
}

describe('notNull / unique handler 文件路径模式', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('notNull：后端业务失败（success:false）返回 error 而非 pass', async () => {
    vi.mocked(apiValidateNotNull).mockResolvedValue({
      success: false,
      validation_type: 'not_null',
      data: null,
      error: '文件不存在: /data/users.csv',
    })

    const handler = getHandlerByKind('notNull')
    expect(handler).not.toBeNull()

    const result = await handler!.validate(makeFileModeCtx())
    expect(result.status).toBe('error')
    expect(result.validationErrors[0]).toContain('文件不存在')
    expect(result.lastValidation).toBeUndefined()
  })

  it('unique：后端业务失败（success:false）返回 error 而非 pass', async () => {
    vi.mocked(apiValidateUnique).mockResolvedValue({
      success: false,
      validation_type: 'unique',
      data: null,
      error: '文件不存在: /data/users.csv',
    })

    const handler = getHandlerByKind('unique')
    expect(handler).not.toBeNull()

    const result = await handler!.validate(makeFileModeCtx())
    expect(result.status).toBe('error')
    expect(result.validationErrors[0]).toContain('文件不存在')
    expect(result.lastValidation).toBeUndefined()
  })

  it('notNull：后端正常返回零错误时仍为 pass（不误伤正常路径）', async () => {
    vi.mocked(apiValidateNotNull).mockResolvedValue({
      success: true,
      validation_type: 'not_null',
      data: {
        is_valid: true,
        error_count: 0,
        total_rows: 5,
        match_count: 5,
        error_rows: [],
        validation_time: '2026-01-01T00:00:00Z',
      },
      error: null,
    })

    const handler = getHandlerByKind('notNull')
    const result = await handler!.validate(makeFileModeCtx())
    expect(result.status).toBe('pass')
    expect(result.lastValidation?.totalRows).toBe(5)
  })
})
