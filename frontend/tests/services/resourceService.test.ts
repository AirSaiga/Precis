/**
 * @fileoverview resourceService Pattern API 路由测试
 *
 * 重点回归：Pattern 的重命名/删除必须走专用 Pattern API（/project/pattern/{name}），
 * 过去误调 /project/regex/{id}，而资源树 Pattern id 形如 "patterns/email"，
 * encodeURIComponent 后后端路由必然 404。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resourceService } from '@/services/resourceService'
import * as projectV2Api from '@/api/projectV2Api'

vi.mock('@/api/projectV2Api', () => ({
  deleteV2Pattern: vi.fn(),
  createV2Pattern: vi.fn(),
  listV2Patterns: vi.fn(),
  deleteV2RegexNode: vi.fn(),
  updateV2RegexNodeDisplayName: vi.fn(),
}))

describe('resourceService Pattern API 路由', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deletePattern 剥离 "patterns/" 前缀后调用专用 Pattern API', async () => {
    vi.mocked(projectV2Api.deleteV2Pattern).mockResolvedValue({
      pattern_name: 'email',
      deleted: true,
    })

    await resourceService.deletePattern('patterns/email', '/proj')

    expect(projectV2Api.deleteV2Pattern).toHaveBeenCalledWith('email', '/proj')
    expect(projectV2Api.deleteV2RegexNode).not.toHaveBeenCalled()
  })

  it('renamePattern 走"新建新名 + 删除旧名"，不再误调 regex 节点 API', async () => {
    vi.mocked(projectV2Api.listV2Patterns).mockResolvedValue([
      { name: 'email', regex: '^.+@.+$', output: { kind: 'match' }, description: '邮箱' },
      { name: 'phone', regex: '^1\\d{10}$' },
    ])
    vi.mocked(projectV2Api.createV2Pattern).mockResolvedValue({
      pattern_name: '邮箱规则',
    } as never)
    vi.mocked(projectV2Api.deleteV2Pattern).mockResolvedValue({
      pattern_name: 'email',
      deleted: true,
    })

    await resourceService.renamePattern('patterns/email', '邮箱规则', '/proj')

    expect(projectV2Api.createV2Pattern).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '邮箱规则',
        regex: '^.+@.+$',
        output: { kind: 'match' },
      }),
      '/proj'
    )
    expect(projectV2Api.deleteV2Pattern).toHaveBeenCalledWith('email', '/proj')
    expect(projectV2Api.updateV2RegexNodeDisplayName).not.toHaveBeenCalled()
  })

  it('renamePattern 找不到 Pattern 定义时抛出含名称的错误', async () => {
    vi.mocked(projectV2Api.listV2Patterns).mockResolvedValue([{ name: 'other', regex: 'x' }])

    await expect(resourceService.renamePattern('patterns/missing', 'new', '/proj')).rejects.toThrow(
      'Pattern not found: missing'
    )
    expect(projectV2Api.createV2Pattern).not.toHaveBeenCalled()
  })
})
