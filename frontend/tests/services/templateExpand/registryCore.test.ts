/**
 * 模板展开后置钩子注册表测试
 *
 * 验证注册表的基本行为：
 *   - registerTemplateExpandHandler 注册 handler
 *   - executeTemplateExpandHooks 按 priority 排序执行
 *   - 单个 handler 失败不影响后续处理
 *   - 第一个 match 成功的 handler 执行后即停止（一个 dagNode 只有一个 handler 处理）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import {
  registerTemplateExpandHandler,
  executeTemplateExpandHooks,
  _resetTemplateExpandHandlers,
} from '@/services/templateExpand/registryCore'
import type { TemplateExpandDagNode, TemplateExpandContext } from '@/services/templateExpand/types'

function makeCtx(): TemplateExpandContext {
  return {
    nodes: ref([]) as any,
    edges: ref([]) as any,
    updateNodeData: vi.fn(),
  }
}

function makeDagNode(
  id: string,
  kind: TemplateExpandDagNode['kind'] = 'transform'
): TemplateExpandDagNode {
  return { id, origin: 'real', kind }
}

describe('templateExpand registry', () => {
  beforeEach(() => {
    _resetTemplateExpandHandlers()
  })

  it('按 priority 升序找到首个匹配 handler', async () => {
    const order: string[] = []
    registerTemplateExpandHandler({
      priority: 100,
      match: () => true,
      execute: () => {
        order.push('p100')
      },
    })
    registerTemplateExpandHandler({
      priority: 50,
      match: () => true,
      execute: () => {
        order.push('p50')
      },
    })
    registerTemplateExpandHandler({
      priority: 200,
      match: () => true,
      execute: () => {
        order.push('p200')
      },
    })

    await executeTemplateExpandHooks([makeDagNode('n1')], makeCtx())

    // 首个 match 成功的是 priority 50（最低），后续不再尝试
    expect(order).toEqual(['p50'])
  })

  it('每个 dagNode 只由第一个匹配的 handler 处理', async () => {
    const calls: string[] = []
    registerTemplateExpandHandler({
      priority: 50,
      match: (n) => n.kind === 'transform',
      execute: (n) => {
        calls.push(`a:${n.id}`)
      },
    })
    registerTemplateExpandHandler({
      priority: 100,
      match: () => true,
      execute: (n) => {
        calls.push(`b:${n.id}`)
      },
    })

    await executeTemplateExpandHooks([makeDagNode('n1', 'transform')], makeCtx())

    // 第一个 match 成功的是 priority 50，priority 100 不应执行
    expect(calls).toEqual(['a:n1'])
  })

  it('单个 handler 失败不影响其他 dagNode 的处理', async () => {
    const order: string[] = []
    // priority 50 处理 n1 失败
    registerTemplateExpandHandler({
      priority: 50,
      match: (n) => n.id === 'n1',
      execute: () => {
        throw new Error('boom')
      },
    })
    // priority 100 处理 n2 成功
    registerTemplateExpandHandler({
      priority: 100,
      match: (n) => n.id === 'n2',
      execute: (n) => {
        order.push(`ok:${n.id}`)
      },
    })

    // 不应抛出
    await expect(
      executeTemplateExpandHooks([makeDagNode('n1'), makeDagNode('n2')], makeCtx())
    ).resolves.not.toThrow()
    expect(order).toEqual(['ok:n2'])
  })

  it('没有匹配 handler 时不执行', async () => {
    const fn = vi.fn()
    registerTemplateExpandHandler({
      priority: 50,
      match: () => false,
      execute: fn,
    })
    await executeTemplateExpandHooks([makeDagNode('n1')], makeCtx())
    expect(fn).not.toHaveBeenCalled()
  })

  it('handler 接收 ctx 参数', async () => {
    const updateNodeData = vi.fn()
    const ctx: TemplateExpandContext = {
      nodes: ref([]) as any,
      edges: ref([]) as any,
      updateNodeData,
    }
    let receivedCtx: TemplateExpandContext | null = null
    registerTemplateExpandHandler({
      priority: 50,
      match: () => true,
      execute: (_n, c) => {
        receivedCtx = c
      },
    })
    await executeTemplateExpandHooks([makeDagNode('n1')], ctx)
    expect(receivedCtx).toBe(ctx)
    expect(receivedCtx!.updateNodeData).toBe(updateNodeData)
  })
})
