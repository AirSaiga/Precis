/**
 * Transform 模板展开 handler 单元测试
 *
 * 重点验证多列 transform（StringSplit/RegexExtract）的逐列写入行为：
 *   - 每列数据写入独立的合成 transformOutput 节点（id: output-${transformId}-${i}）
 *   - 不再只写首列、丢弃其余列
 *   - MathExpr 的 columnDataType 兜底逻辑
 *
 * 注意：本文件故意不 mock `@/services/templateExpand`，让真实的 transform handler 注册并执行，
 * 以覆盖 registryCore.test.ts 无法触及的逐列计算逻辑。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import type { CustomNode } from '@/types/graph'
import type { CustomNodeData } from '@/types/nodes'
// side-effect import：触发 transform handler 自注册
import '@/services/templateExpand/registryHandlers/transform'
import { executeTemplateExpandHooks } from '@/services/templateExpand/registryCore'
import type { TemplateExpandDagNode, TemplateExpandContext } from '@/services/templateExpand/types'

/** 构造 CustomNode（按 type + data 覆盖） */
function makeNode(
  id: string,
  type: string,
  data: Partial<CustomNodeData> & Record<string, unknown>
): CustomNode {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data: data as unknown as CustomNodeData,
  } as CustomNode
}

/** 构造真实 transform dagNode（带 item，触发 handler match） */
function makeTransformDag(
  transformId: string,
  item: { id: string; type: string; inputFromNode: string | null; data: Record<string, unknown> }
): TemplateExpandDagNode {
  return {
    id: transformId,
    origin: 'real',
    kind: 'transform',
    item: item as any,
  }
}

/** 构造 ctx，nodes 由调用方控制画布状态，updateNodeData 收集所有写入 */
function makeCtx(canvasNodes: CustomNode[]): TemplateExpandContext & {
  updateNodeData: ReturnType<typeof vi.fn>
} {
  return {
    nodes: ref(canvasNodes) as any,
    edges: ref([]) as any,
    updateNodeData: vi.fn(),
  }
}

describe('transform handler — 多列输出', () => {
  it('StringSplit 拆出 2 列时，分别为两列合成节点写入数据', async () => {
    // 画布：manualData 上游 + transform 节点（inputFromNode 指向上游）
    const upstream = makeNode('md1', 'manualData', {
      rows: [['alice,smith'], ['bob,jones']],
      columnDataType: 'String',
    })
    const transform = makeNode('t1', 'transform', {
      transformType: 'StringSplit',
      inputFromNode: 'md1',
      inputColumn: 'full',
      outputColumns: ['first', 'last'],
      params: { delimiter: ',', maxsplit: -1 },
    })
    const ctx = makeCtx([upstream, transform])

    const dag = makeTransformDag('t1', {
      id: 't1',
      type: 'StringSplit',
      inputFromNode: 'md1',
      data: transform.data as Record<string, unknown>,
    })

    await executeTemplateExpandHooks([dag], ctx)

    // 应为两列各调用一次 updateNodeData，节点 id 分别为 output-t1-0 / output-t1-1
    const calls = ctx.updateNodeData.mock.calls
    const targetIds = calls.map((c) => c[0])
    expect(targetIds).toEqual(['output-t1-0', 'output-t1-1'])

    // 第 0 列（first）：alice / bob
    const col0 = calls[0][1] as Record<string, unknown>
    expect(col0.columnName).toBe('first')
    expect(col0.rows).toEqual([['alice'], ['bob']])
    expect(col0.saveState).toBe('saved')

    // 第 1 列（last）：smith / jones —— 此前会被静默丢弃
    const col1 = calls[1][1] as Record<string, unknown>
    expect(col1.columnName).toBe('last')
    expect(col1.rows).toEqual([['smith'], ['jones']])
  })

  it('单列 transform 仍写入 output-{id}-0', async () => {
    const upstream = makeNode('md1', 'manualData', {
      rows: [['hi']],
      columnDataType: 'String',
    })
    const transform = makeNode('t1', 'transform', {
      transformType: 'UpperCase',
      inputFromNode: 'md1',
      inputColumn: 'name',
      outputColumns: ['upper'],
      params: {},
    })
    const ctx = makeCtx([upstream, transform])

    const dag = makeTransformDag('t1', {
      id: 't1',
      type: 'UpperCase',
      inputFromNode: 'md1',
      data: transform.data as Record<string, unknown>,
    })

    await executeTemplateExpandHooks([dag], ctx)

    const calls = ctx.updateNodeData.mock.calls
    expect(calls.map((c) => c[0])).toEqual(['output-t1-0'])
    const data = calls[0][1] as Record<string, unknown>
    expect(data.columnName).toBe('upper')
    expect(data.rows).toEqual([['HI']])
  })

  it('MathExpr 未指定 outputType 时，columnDataType 回退到上游列类型', async () => {
    const upstream = makeNode('md1', 'manualData', {
      rows: [['5']],
      columnDataType: 'Integer',
    })
    const transform = makeNode('t1', 'transform', {
      transformType: 'MathExpr',
      inputFromNode: 'md1',
      inputColumn: 'n',
      outputColumns: ['result'],
      params: { expression: '@n + 1' },
    })
    const ctx = makeCtx([upstream, transform])

    const dag = makeTransformDag('t1', {
      id: 't1',
      type: 'MathExpr',
      inputFromNode: 'md1',
      data: transform.data as Record<string, unknown>,
    })

    await executeTemplateExpandHooks([dag], ctx)

    const data = ctx.updateNodeData.mock.calls[0][1] as Record<string, unknown>
    // MathExpr 未声明 output_type → outputDataType 为空 → 回退到上游 Integer
    expect(data.columnDataType).toBe('Integer')
  })

  it('上游无数据时跳过写入（不报错）', async () => {
    const upstream = makeNode('md1', 'manualData', { rows: [] })
    const transform = makeNode('t1', 'transform', {
      transformType: 'StringSplit',
      inputFromNode: 'md1',
      outputColumns: ['a', 'b'],
      params: { delimiter: ',' },
    })
    const ctx = makeCtx([upstream, transform])

    const dag = makeTransformDag('t1', {
      id: 't1',
      type: 'StringSplit',
      inputFromNode: 'md1',
      data: transform.data as Record<string, unknown>,
    })

    await executeTemplateExpandHooks([dag], ctx)
    expect(ctx.updateNodeData).not.toHaveBeenCalled()
  })
})
