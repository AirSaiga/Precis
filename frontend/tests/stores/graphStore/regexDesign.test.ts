import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, type Ref } from 'vue'
import type { CustomNode, CustomNodeData } from '@/types/graph'

vi.mock('@/core/utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock('@/core/toast', () => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}))

vi.mock('@/core/eventBus', () => ({
  eventBus: { emit: vi.fn() },
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: any) => (params ? `${key}:${JSON.stringify(params)}` : key),
  }),
}))

import { eventBus } from '@/core/eventBus'
import { toastSuccess } from '@/core/toast'
import { createRegexDesignModule } from '@/stores/graphStore/modules/regexDesign'

function makeRegexNode(id: string, data: Record<string, unknown> = {}): CustomNode {
  return {
    id,
    type: 'regex',
    position: { x: 0, y: 0 },
    data: {
      configName: 'TestRegex',
      pattern: '\\d+',
      matchMode: 'full',
      rules: [{ regex: '\\d+', output: {} }],
      sourceRef: { nodeId: 's1', columnId: 'c_email' },
      ...data,
    } as unknown as CustomNodeData,
  } as CustomNode
}

describe('createRegexDesignModule', () => {
  let nodes: Ref<CustomNode[]>
  let designModalVisible: Ref<boolean>
  let activeRegexNodeId: Ref<string | null>
  let regexEditSampleData: Ref<string>
  let module: ReturnType<typeof createRegexDesignModule>
  const mockUpdateNodeData = vi.fn()

  beforeEach(() => {
    nodes = ref<CustomNode[]>([])
    designModalVisible = ref(false)
    activeRegexNodeId = ref<string | null>(null)
    regexEditSampleData = ref('')

    module = createRegexDesignModule({
      nodes,
      designModalVisible,
      activeRegexNodeId,
      regexEditSampleData,
      updateNodeData: mockUpdateNodeData,
    })

    mockUpdateNodeData.mockClear()
    vi.mocked(eventBus.emit).mockClear()
    vi.mocked(toastSuccess).mockClear()
  })

  describe('openRegexDesignModal', () => {
    it('设置弹窗可见性和节点 ID', () => {
      module.openRegexDesignModal('r1')
      expect(designModalVisible.value).toBe(true)
      expect(activeRegexNodeId.value).toBe('r1')
    })
  })

  describe('closeRegexDesignModal', () => {
    it('重置所有状态', () => {
      designModalVisible.value = true
      activeRegexNodeId.value = 'r1'
      regexEditSampleData.value = 'sample'

      module.closeRegexDesignModal()

      expect(designModalVisible.value).toBe(false)
      expect(activeRegexNodeId.value).toBeNull()
      expect(regexEditSampleData.value).toBe('')
    })
  })

  describe('setRegexEditSampleData', () => {
    it('设置示例数据', () => {
      module.setRegexEditSampleData('hello world')
      expect(regexEditSampleData.value).toBe('hello world')
    })
  })

  describe('saveRegexDesign', () => {
    it('更新节点数据', () => {
      nodes.value = [makeRegexNode('r1')]

      module.saveRegexDesign('r1', {
        pattern: '[a-z]+',
        rules: [{ regex: '[a-z]+', output: {} }],
      } as any)

      expect(mockUpdateNodeData).toHaveBeenCalledWith(
        'r1',
        expect.objectContaining({
          saveState: 'draft',
        })
      )
    })

    it('pattern 变更时触发自动重校验', () => {
      nodes.value = [makeRegexNode('r1', { pattern: '\\d+' })]

      module.saveRegexDesign('r1', {
        pattern: '[a-z]+',
        rules: [{ regex: '[a-z]+', output: {} }],
      } as any)

      expect(eventBus.emit).toHaveBeenCalledWith(
        'regex-pattern-updated',
        expect.objectContaining({
          nodeId: 'r1',
          reason: 'pattern',
        })
      )
    })

    it('pattern 未变更时不触发重校验', () => {
      nodes.value = [makeRegexNode('r1', { pattern: '\\d+' })]

      module.saveRegexDesign('r1', {
        pattern: '\\d+',
        rules: [{ regex: '\\d+', output: {} }],
      } as any)

      expect(eventBus.emit).not.toHaveBeenCalled()
    })

    it('节点不存在时记录错误', () => {
      nodes.value = []
      module.saveRegexDesign('nonexistent', { pattern: 'test' } as any)
      expect(mockUpdateNodeData).not.toHaveBeenCalled()
    })

    it('保存成功后关闭弹窗', () => {
      nodes.value = [makeRegexNode('r1')]

      module.saveRegexDesign('r1', { pattern: '[a-z]+' } as any)

      expect(designModalVisible.value).toBe(false)
    })

    it('有 output mapping 时不改变 Regex 校验节点的 matchMode', () => {
      nodes.value = [makeRegexNode('r1', { matchMode: 'full' })]

      module.saveRegexDesign('r1', {
        rules: [{ regex: '\\d+', output: { group1: 'col1' } }],
      } as any)

      expect(mockUpdateNodeData).toHaveBeenCalledWith(
        'r1',
        expect.objectContaining({
          matchMode: 'full',
        })
      )
    })

    it('显示保存成功 toast', () => {
      nodes.value = [makeRegexNode('r1')]

      module.saveRegexDesign('r1', { pattern: '[a-z]+' } as any)

      expect(toastSuccess).toHaveBeenCalled()
    })
  })
})
