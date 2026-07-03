import { describe, it, expect } from 'vitest'
import { serializeCanvasForAI } from '@/utils/ai/serializeCanvasForAI'
import type { CustomNode } from '@/types/nodes'

/**
 * 工厂函数：构造最小可用的 CustomNode（serializeCanvasForAI 只读 id/type/data）。
 * CustomNode = Node<CustomNodeData>，Vue Flow Node 要求 position，故补占位。
 */
function makeNode(overrides: Partial<CustomNode> & { id: string; type: string }): CustomNode {
  return {
    position: { x: 0, y: 0 },
    data: {} as CustomNode['data'],
    ...overrides,
  } as CustomNode
}

describe('serializeCanvasForAI', () => {
  it('过滤结构性节点（projectRoot / Set 容器）', () => {
    const nodes = [
      makeNode({ id: 'root', type: 'projectRoot', data: { name: 'Proj' } }),
      makeNode({ id: 'set1', type: 'TableSetRootNode', data: {} }),
      makeNode({ id: 'set2', type: 'SchemaSetNode', data: {} }),
      makeNode({ id: 'sc_users', type: 'schema', data: { tableName: 'users' } }),
    ]
    const result = serializeCanvasForAI(nodes)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('sc_users')
  })

  it('保留业务节点（schema/constraint/regex/transform）', () => {
    const nodes = [
      makeNode({ id: 'sc_u', type: 'schema', data: { tableName: 'users' } }),
      makeNode({ id: 'c1', type: 'notNullConstraint', data: { configName: 'nn' } }),
      makeNode({ id: 'r1', type: 'regex', data: { configName: '邮箱', pattern: '^a' } }),
      makeNode({ id: 't1', type: 'transform', data: { configName: 'Cast' } }),
    ]
    const result = serializeCanvasForAI(nodes)
    expect(result.map((n) => n.id)).toEqual(['sc_u', 'c1', 'r1', 't1'])
  })

  it('裁剪重型字段（rows/validationErrors/saveState 等）', () => {
    const nodes = [
      makeNode({
        id: 'm1',
        type: 'manualData',
        data: {
          configName: '手动数据',
          rows: [
            ['a', 'b'],
            ['c', 'd'],
            ['e', 'f'],
          ], // 应被丢弃
          validationErrors: [{ msg: 'err' }], // 应被丢弃
          saveState: 'saved', // 应被丢弃
        },
      }),
    ]
    const result = serializeCanvasForAI(nodes)
    expect(result).toHaveLength(1)
    const data = result[0].data
    expect(data.configName).toBe('手动数据') // 语义字段保留
    expect(data.rows).toBeUndefined()
    expect(data.validationErrors).toBeUndefined()
    expect(data.saveState).toBeUndefined()
  })

  it('schema 节点 columns 只保留 id/columnName/dataType', () => {
    const nodes = [
      makeNode({
        id: 'sc_u',
        type: 'schema',
        data: {
          tableName: 'users',
          columns: [
            {
              id: 'col_email',
              columnName: 'email',
              dataType: 'string',
              constraints: { notNull: { id: 'x' } }, // 应被丢弃
              validationErrors: [], // 应被丢弃
              bindingConfig: { foo: 'bar' }, // 应被丢弃
            },
          ],
        },
      }),
    ]
    const result = serializeCanvasForAI(nodes)
    const col = (result[0].data.columns as Array<Record<string, unknown>>)[0]
    expect(Object.keys(col).sort()).toEqual(['columnName', 'dataType', 'id'])
    expect(col.constraints).toBeUndefined()
  })

  it('提取 label（schema 用 tableName，约束用 configName）', () => {
    const nodes = [
      makeNode({
        id: 'sc_u',
        type: 'schema',
        data: { tableName: 'users', configName: 'Schema_users' },
      }),
      makeNode({ id: 'c1', type: 'uniqueConstraint', data: { configName: 'uniq_email' } }),
    ]
    const result = serializeCanvasForAI(nodes)
    expect(result[0].label).toBe('users') // schema 优先 tableName
    expect(result[1].label).toBe('uniq_email')
  })

  it('空画布返回空数组', () => {
    expect(serializeCanvasForAI([])).toEqual([])
  })

  it('无 type 节点被过滤（视为结构性）', () => {
    const nodes = [makeNode({ id: 'n1', type: '', data: { configName: 'x' } })]
    expect(serializeCanvasForAI(nodes)).toEqual([])
  })
})
