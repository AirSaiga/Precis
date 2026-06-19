/**
 * @fileoverview regexValidationHandler 单元测试
 *
 * 重点验证从 validationRegistryCore 拆出的 validateRegexNodesForSchema：
 * - 无 regex 边时返回 null
 * - extract 模式被跳过
 * - full 模式触发校验并汇总错误
 */

import { describe, it, expect, vi } from 'vitest'
import { validateRegexNodesForSchema } from '@/services/regex/regexValidationHandler'
import { validateAndExtractRegex } from '@/features/regex/services/regexExtractService'
import type { Node, Edge } from '@vue-flow/core'

vi.mock('@/features/regex/services/regexExtractService', () => ({
  validateAndExtractRegex: vi.fn(),
}))

vi.mock('@/services/canvas/vueFlowApi', () => ({
  findEdge: vi.fn(() => null),
}))

function makeSchemaNode(): Node<any, any, string> {
  return {
    id: 'schema-1',
    type: 'schema',
    position: { x: 0, y: 0 },
    data: {
      tableName: 'users',
      sourceFile: 'users.csv',
      sourceFilePath: '/data/users.csv',
      sourceNodeId: 'preview-1',
      headerRow: 0,
      columns: [{ id: 'col-email', columnName: 'email' }],
    },
  } as Node<any, any, string>
}

function makeSourcePreviewNode(): Node<any, any, string> {
  return {
    id: 'preview-1',
    type: 'sourcePreview',
    position: { x: 0, y: 0 },
    data: {
      data: [['email'], ['a@example.com'], ['bad'], ['b@example.com']],
      headerRow: 0,
    },
  } as Node<any, any, string>
}

function makeRegexNode(
  overrides?: Partial<Node<any, any, string>['data']>
): Node<any, any, string> {
  return {
    id: 'regex-1',
    type: 'regex',
    position: { x: 0, y: 0 },
    data: {
      configName: 'Email Regex',
      pattern: '^[\\w.-]+@[\\w.-]+\\.\\w+$',
      flags: '',
      matchMode: 'full',
      caseSensitive: true,
      ...overrides,
    },
  } as Node<any, any, string>
}

function makeEdge(sourceHandle: string): Edge {
  return {
    id: 'e1',
    source: 'schema-1',
    target: 'regex-1',
    sourceHandle,
  } as Edge
}

describe('validateRegexNodesForSchema', () => {
  it('无 regex 边时返回 null', async () => {
    const result = await validateRegexNodesForSchema({
      schemaNode: makeSchemaNode(),
      schemaEdges: [],
      nodes: [makeSchemaNode(), makeSourcePreviewNode()],
      edges: [],
      updateNodeData: vi.fn(),
    })
    expect(result).toBeNull()
  })

  it('extract 模式的 regex 节点被跳过', async () => {
    const regexNode = makeRegexNode({ matchMode: 'extract' })
    const schemaNode = makeSchemaNode()
    const updateNodeData = vi.fn()

    const result = await validateRegexNodesForSchema({
      schemaNode,
      schemaEdges: [makeEdge('source-right-col-email')],
      nodes: [schemaNode, makeSourcePreviewNode(), regexNode],
      edges: [makeEdge('source-right-col-email')],
      updateNodeData,
    })

    expect(result).toEqual({
      totalValid: 0,
      totalInvalid: 0,
      totalErrorCount: 0,
      columnErrorMap: new Map(),
    })
    expect(validateAndExtractRegex).not.toHaveBeenCalled()
  })

  it('full 模式校验失败时汇总错误', async () => {
    vi.mocked(validateAndExtractRegex).mockResolvedValue({
      total_rows: 3,
      match_count: 2,
      error_count: 1,
      error_rows: [{ row_index: 1, cell_value: 'bad', error_message: 'not match' }],
      group_names: [],
      extracted_columns: {},
    })

    const schemaNode = makeSchemaNode()
    const regexNode = makeRegexNode()
    const updateNodeData = vi.fn()

    const result = await validateRegexNodesForSchema({
      schemaNode,
      schemaEdges: [makeEdge('source-right-col-email')],
      nodes: [schemaNode, makeSourcePreviewNode(), regexNode],
      edges: [makeEdge('source-right-col-email')],
      updateNodeData,
    })

    expect(result).not.toBeNull()
    expect(result!.totalInvalid).toBe(1)
    expect(result!.totalErrorCount).toBe(1)
    expect(result!.columnErrorMap.get('col-email')).toEqual(['Regex: 1 errors'])
    expect(updateNodeData).toHaveBeenCalledWith(
      'regex-1',
      expect.objectContaining({
        validationStatus: 'error',
        errorCount: 1,
        totalRows: 3,
      })
    )
  })

  it('full 模式校验通过时汇总通过数', async () => {
    vi.mocked(validateAndExtractRegex).mockResolvedValue({
      total_rows: 3,
      match_count: 3,
      error_count: 0,
      error_rows: [],
      group_names: [],
      extracted_columns: {},
    })

    const schemaNode = makeSchemaNode()
    const regexNode = makeRegexNode()
    const updateNodeData = vi.fn()

    const result = await validateRegexNodesForSchema({
      schemaNode,
      schemaEdges: [makeEdge('source-right-col-email')],
      nodes: [schemaNode, makeSourcePreviewNode(), regexNode],
      edges: [makeEdge('source-right-col-email')],
      updateNodeData,
    })

    expect(result).not.toBeNull()
    expect(result!.totalValid).toBe(1)
    expect(result!.totalInvalid).toBe(0)
    expect(updateNodeData).toHaveBeenCalledWith(
      'regex-1',
      expect.objectContaining({
        validationStatus: 'pass',
        errorCount: 0,
      })
    )
  })
})
