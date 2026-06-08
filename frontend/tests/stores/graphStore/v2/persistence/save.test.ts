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
    resolve: vi.fn().mockResolvedValue({ cancelled: false, saveMode: 'overwrite', filePath: 'test.yaml' }),
    handle409Conflict: vi.fn().mockResolvedValue('overwrite'),
  })),
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

import { putV2Constraint, putV2RegexNode, putV2TransformNode, updateV2ManifestConstraintRef, updateV2ManifestRegexRef, updateV2ManifestTransformRef, updateV2ManifestTemplateInstanceRef } from '@/api/projectV2Api'
import { buildNodeFile } from '@/services/persistence'
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
})
