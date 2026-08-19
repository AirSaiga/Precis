import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, type Ref } from 'vue'
import type { Edge } from '@vue-flow/core'
import type { CustomNode, CustomNodeData } from '@/types/graph'

vi.mock('@/core/utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock('@/core/toast', () => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  toastWarning: vi.fn(),
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('@/api/projectV2Api', () => ({
  putV2FullConfig: vi.fn(),
  putV2ProjectView: vi.fn(),
  putV2Schema: vi.fn(),
  putV2Constraint: vi.fn(),
  putV2RegexNode: vi.fn(),
  putV2TransformNode: vi.fn(),
  updateV2ManifestSchemaRef: vi.fn(),
  updateV2ManifestConstraintRef: vi.fn(),
  updateV2ManifestRegexRef: vi.fn(),
  updateV2ManifestTransformRef: vi.fn(),
  updateV2ManifestTemplateInstanceRef: vi.fn(),
  getV2FullConfig: vi.fn(),
  getV2ProjectView: vi.fn(),
  ProjectNotFoundError: class ProjectNotFoundError extends Error {
    configPath?: string
    constructor(msg: string, path?: string) {
      super(msg)
      this.configPath = path
    }
  },
}))

vi.mock('@/services/builders', () => ({
  buildV2ConstraintFile: vi.fn(),
  buildV2FullConfig: vi.fn(),
  buildV2Manifest: vi.fn(),
  buildV2ProjectView: vi.fn(),
  buildV2RegexNodeFile: vi.fn(),
  buildV2TransformFile: vi.fn(),
  buildV2SchemaFile: vi.fn(),
}))

vi.mock('@/services/persistence', () => ({
  SaveOrchestrator: vi.fn().mockImplementation(() => ({
    saveProject: vi.fn().mockResolvedValue({ success: true }),
  })),
  buildNodeFile: vi.fn(),
  SchemaConflictResolver: vi.fn().mockImplementation(() => ({
    resolve: vi
      .fn()
      .mockResolvedValue({ cancelled: false, saveMode: 'overwrite', filePath: 'test.yaml' }),
    handle409Conflict: vi.fn().mockResolvedValue('overwrite'),
  })),
  // D-1 方案 B：直通实现（空判与草稿计数用；单测场景无 draft 节点）
  filterPersistentNodes: vi.fn((nodes: unknown[]) => nodes),
  isIncompleteDraftNode: vi.fn(() => false),
}))

vi.mock('@/composables/useGlobalConfirm', () => ({
  useGlobalConfirm: () => ({ showConfirm: vi.fn() }),
}))

vi.mock('@/services/constraints/validationRegistry', () => ({
  isConstraintNodeType: vi.fn((type: string) => type.includes('Constraint')),
}))

vi.mock('@/features/keyboard/platform', () => ({
  platformDetector: { isWindows: () => false },
}))

import {
  putV2Constraint,
  putV2RegexNode,
  putV2TransformNode,
  updateV2ManifestConstraintRef,
  updateV2ManifestRegexRef,
  updateV2ManifestTransformRef,
  updateV2ManifestTemplateInstanceRef,
} from '@/api/projectV2Api'
import { buildNodeFile, SaveOrchestrator, isIncompleteDraftNode } from '@/services/persistence'
import { toastSuccess, toastError } from '@/core/toast'
import { buildV2Manifest } from '@/services/builders'
import { createV2SaveOps } from '@/stores/graphStore/modules/v2/persistence/save'

function makeNode(id: string, type: string, data: Record<string, unknown> = {}): CustomNode {
  return { id, type, position: { x: 0, y: 0 }, data: data as CustomNodeData } as CustomNode
}

describe('createV2SaveOps', () => {
  let nodes: Ref<CustomNode[]>
  let edges: Ref<Edge[]>
  let projectName: Ref<string>
  let saveOps: ReturnType<typeof createV2SaveOps>

  beforeEach(() => {
    nodes = ref<CustomNode[]>([])
    edges = ref<Edge[]>([])
    projectName = ref('test-project')

    saveOps = createV2SaveOps({
      nodes,
      edges,
      projectName,
      getEffectiveProjectConfigPath: () => '/project',
      updateNodeData: (nodeId: string, newData: Partial<CustomNodeData>) => {
        nodes.value = nodes.value.map((n) => {
          if (n.id !== nodeId) return n
          return { ...n, data: { ...n.data, ...newData } } as CustomNode
        })
      },
    })

    vi.mocked(putV2Constraint).mockClear()
    vi.mocked(putV2RegexNode).mockClear()
    vi.mocked(putV2TransformNode).mockClear()
    vi.mocked(buildNodeFile).mockClear()
    vi.mocked(SaveOrchestrator).mockClear()
    vi.mocked(buildV2Manifest).mockClear()
  })

  describe('saveConstraintNode', () => {
    it('保存约束节点并更新 saveState', async () => {
      const node = makeNode('c1', 'notNullConstraint', { configName: 'test', saveState: 'draft' })
      nodes.value = [node]
      vi.mocked(buildNodeFile).mockReturnValue({ type: 'NotNull' } as any)

      const result = await saveOps.saveConstraintNode('c1')

      expect(result).toBe(true)
      expect(putV2Constraint).toHaveBeenCalledWith('c1', expect.any(Object), '/project')
      expect(updateV2ManifestConstraintRef).toHaveBeenCalled()
      expect((nodes.value[0].data as any).saveState).toBe('saved')
      expect((nodes.value[0].data as any).lastSaved).toBeDefined()
    })

    it('节点不存在时返回 false', async () => {
      const result = await saveOps.saveConstraintNode('nonexistent')
      expect(result).toBe(false)
    })
  })

  describe('saveRegexNode', () => {
    it('保存正则节点并更新 saveState', async () => {
      const node = makeNode('r1', 'regex', { configName: 'EmailRegex', saveState: 'draft' })
      nodes.value = [node]
      vi.mocked(buildNodeFile).mockReturnValue({ pattern: '\\d+' } as any)

      const result = await saveOps.saveRegexNode('r1')

      expect(result).toBe(true)
      expect(putV2RegexNode).toHaveBeenCalledWith('r1', expect.any(Object), '/project')
      expect(updateV2ManifestRegexRef).toHaveBeenCalled()
      expect((nodes.value[0].data as any).saveState).toBe('saved')
    })

    it('节点不存在时返回 false', async () => {
      const result = await saveOps.saveRegexNode('nonexistent')
      expect(result).toBe(false)
    })
  })

  describe('saveTransformNode', () => {
    it('保存 Transform 节点并更新 saveState', async () => {
      const node = makeNode('t1', 'transform', { configName: 'MyTransform', saveState: 'draft' })
      nodes.value = [node]
      vi.mocked(buildNodeFile).mockReturnValue({ type: 'StringSplit' } as any)

      const result = await saveOps.saveTransformNode('t1')

      expect(result).toBe(true)
      expect(putV2TransformNode).toHaveBeenCalledWith('t1', expect.any(Object), '/project')
      expect(updateV2ManifestTransformRef).toHaveBeenCalled()
      expect((nodes.value[0].data as any).saveState).toBe('saved')
    })

    it('节点不存在时返回 false', async () => {
      const result = await saveOps.saveTransformNode('nonexistent')
      expect(result).toBe(false)
    })
  })

  describe('saveTemplateInstanceNode', () => {
    it('保存模板实例节点', async () => {
      const node = makeNode('ti1', 'templateInstance', {
        configName: 'MyTemplate',
        templateId: 'tmpl1',
        enabled: true,
        parameters: {},
        saveState: 'draft',
      })
      nodes.value = [node]
      vi.mocked(buildNodeFile).mockReturnValue({ id: 'ti1', template_id: 'tmpl1' } as any)

      const result = await saveOps.saveTemplateInstanceNode('ti1')

      expect(result).toBe(true)
      expect(updateV2ManifestTemplateInstanceRef).toHaveBeenCalled()
      expect((nodes.value[0].data as any).saveState).toBe('saved')
    })

    it('节点不存在时返回 false', async () => {
      const result = await saveOps.saveTemplateInstanceNode('nonexistent')
      expect(result).toBe(false)
    })
  })

  describe('saveProject 并发护栏', () => {
    let orchestratorSaveMock: ReturnType<typeof vi.fn>

    beforeEach(() => {
      // 让 buildV2Manifest 返回非空 schemas，使 saveProject 通过空节点检查进入 orchestrator 路径
      vi.mocked(buildV2Manifest).mockReturnValue({ schemas: [{ id: 's1' }] } as any)
      // 每个测试重建 orchestrator.saveProject 的 mock，避免跨测试污染
      orchestratorSaveMock = vi.fn().mockResolvedValue({ success: true })
      // 注意：vi.mock 工厂返回的构造函数 mock 需用 function 形式以支持 new
      vi.mocked(SaveOrchestrator).mockImplementation(function () {
        return { saveProject: orchestratorSaveMock } as any
      })
    })

    it('进行中的保存被复用，settle 后补存一次保证新编辑不丢失', async () => {
      // 用 deferred 让每次保存保持 in-flight：收集所有 resolver，测试按需放行。
      // 补存逻辑会在第一次 settle 后再发起一次 saveProject（第二次调用），需分别 resolve。
      const resolvers: Array<(val: { success: boolean }) => void> = []
      orchestratorSaveMock.mockImplementation(
        () =>
          new Promise<{ success: boolean }>((resolve) => {
            resolvers.push(resolve)
          })
      )

      // 同时发起两次保存（不等第一次 resolve）
      const p1 = saveOps.saveProject()
      // 让出微任务，使第一次调用进入 in-flight 状态（设置 inflightSave）
      await Promise.resolve()
      const p2 = saveOps.saveProject()

      // 并发期间：两次调用复用同一个进行中的 Promise → orchestrator 只构造一次、saveProject 只调用一次
      // （不重叠发起第二次 PUT，避免 last-write-wins）
      expect(SaveOrchestrator).toHaveBeenCalledTimes(1)
      expect(orchestratorSaveMock).toHaveBeenCalledTimes(1)

      // 放行第一次保存；settle 后 finally 会因 dirty 标记自动补存一次（第二次 orchestrator 调用）。
      // p1/p2 复用同一 Promise，其 resolve 被 finally 链式延后到补存完成，故两次调用都需先放行。
      resolvers[0]!({ success: true })
      // 让出微任务，使补存的 saveProject 进入 orchestrator（产生第二次调用）
      await Promise.resolve()
      await Promise.resolve()
      expect(orchestratorSaveMock).toHaveBeenCalledTimes(2)
      resolvers[1]!({ success: true })

      // 两次调用复用同一 Promise，最终都应成功
      const [r1, r2] = await Promise.all([p1, p2])
      expect(r1).toBe(true)
      expect(r2).toBe(true)
    })

    it('上一轮保存 settle 后，新一轮保存正常发起新 orchestrator', async () => {
      await saveOps.saveProject()
      expect(SaveOrchestrator).toHaveBeenCalledTimes(1)
      // 上一轮已 settle，新一轮不应被复用
      await saveOps.saveProject()
      expect(SaveOrchestrator).toHaveBeenCalledTimes(2)
    })
  })

  describe('saveProject D-1 方案 B：未完成草稿跳过持久化', () => {
    it('画布只剩草稿时早退跳过 PUT，但仍提示草稿未保存', async () => {
      // 画布放一个未完成草稿节点（计数来源）
      nodes.value = [makeNode('draft-1', 'schema', { saveState: 'draft' })]
      // 空判命中：过滤后四类资源全空（filterPersistentNodes 直通 + manifest 全空）
      vi.mocked(buildV2Manifest).mockReturnValue({
        schemas: [],
        constraints: [],
        regex_nodes: [],
        transforms: [],
      } as any)
      vi.mocked(isIncompleteDraftNode).mockReturnValue(true)
      toastSuccess.mockClear()

      const result = await saveOps.saveProject()

      expect(result).toBe(true)
      // 早退：不应构造 orchestrator（不发起 PUT）
      expect(SaveOrchestrator).not.toHaveBeenCalled()
      // 但要向用户明示草稿未落盘
      expect(toastSuccess).toHaveBeenCalledWith(
        'messages.persistence.projectSavedWithDrafts',
        'messages.persistence.saveSuccess'
      )
    })

    it('有可保存内容时正常保存，成功 toast 附草稿计数', async () => {
      nodes.value = [
        makeNode('draft-1', 'schema', { saveState: 'draft' }),
        makeNode('draft-2', 'schema', { saveState: 'draft' }),
      ]
      vi.mocked(buildV2Manifest).mockReturnValue({ schemas: [{ id: 's1' }] } as any)
      vi.mocked(SaveOrchestrator).mockImplementation(function () {
        return { saveProject: vi.fn().mockResolvedValue({ success: true }) } as any
      })
      vi.mocked(isIncompleteDraftNode).mockReturnValue(true)
      toastSuccess.mockClear()
      toastError.mockClear()

      const result = await saveOps.saveProject()

      expect(result).toBe(true)
      expect(toastSuccess).toHaveBeenCalledWith(
        'messages.persistence.projectSavedWithDrafts',
        'messages.persistence.saveSuccess'
      )
      // 不应再走"保存失败"分支（修复前 draft 会触发 BLOCKER）
      expect(toastError).not.toHaveBeenCalled()
    })
  })
})
