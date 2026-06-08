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

vi.mock('@/stores/inspectionStore', () => ({
  useInspectionStore: () => ({ setResult: vi.fn() }),
}))

vi.mock('@/api/projectV2Api', () => ({
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

import { getV2FullConfig, getV2ProjectView, ProjectNotFoundError } from '@/api/projectV2Api'
import { createV2LoadOps } from '@/stores/graphStore/modules/v2/persistence/load'

function makeFullConfig(overrides: Record<string, unknown> = {}) {
  return {
    manifest: {
      project: { name: 'TestProject' },
      schemas: [],
      constraints: [],
      regex_nodes: [],
      transforms: [],
      templates: [],
      warnings: [],
      ...overrides,
    },
    schemas: {},
    constraints: {},
    regex_nodes: {},
    transforms: {},
  }
}

describe('createV2LoadOps', () => {
  let nodes: Ref<CustomNode[]>
  let edges: Ref<Edge[]>
  let selectedNodeId: Ref<string | null>
  let projectName: Ref<string>
  let isProjectLoaded: Ref<boolean>
  let projectConfigStats: Ref<any>
  let projectConfigStatsLoaded: Ref<boolean>
  let projectConfigStatsConfigPath: Ref<string>
  let lastFullValidationSummary: Ref<any>
  let lastFullValidationStatistics: Ref<any>
  let loadOps: ReturnType<typeof createV2LoadOps>

  beforeEach(() => {
    nodes = ref<CustomNode[]>([])
    edges = ref<Edge[]>([])
    selectedNodeId = ref<string | null>(null)
    projectName = ref('')
    isProjectLoaded = ref(false)
    projectConfigStats = ref({
      schemaCount: 0, constraintCount: 0, regexCount: 0, transformCount: 0, templateCount: 0,
    })
    projectConfigStatsLoaded = ref(false)
    projectConfigStatsConfigPath = ref('')
    lastFullValidationSummary = ref(null)
    lastFullValidationStatistics = ref(null)

    loadOps = createV2LoadOps({
      nodes,
      edges,
      selectedNodeId,
      projectName,
      isProjectLoaded,
      projectConfigStats,
      projectConfigStatsLoaded,
      projectConfigStatsConfigPath,
      lastFullValidationSummary,
      lastFullValidationStatistics,
      getEffectiveProjectConfigPath: () => '/project',
      resolveProjectRelativePath: (dir, rel) => (dir && rel ? `${dir}/${rel}` : rel),
      saveProject: vi.fn().mockResolvedValue(true),
    })

    vi.mocked(getV2FullConfig).mockClear()
    vi.mocked(getV2ProjectView).mockClear()
  })

  describe('loadProjectFromV2', () => {
    it('成功加载项目', async () => {
      vi.mocked(getV2FullConfig).mockResolvedValue(makeFullConfig() as any)
      vi.mocked(getV2ProjectView).mockResolvedValue({} as any)

      const result = await loadOps.loadProjectFromV2()

      expect(result).toBe(true)
      expect(projectName.value).toBe('TestProject')
      expect(isProjectLoaded.value).toBe(true)
      expect(nodes.value).toHaveLength(1)
      expect(nodes.value[0].type).toBe('projectRoot')
      expect(selectedNodeId.value).toBeNull()
    })

    it('ProjectNotFoundError 时返回 false', async () => {
      vi.mocked(getV2FullConfig).mockRejectedValue(
        new ProjectNotFoundError('Not found', '/bad/path')
      )

      const result = await loadOps.loadProjectFromV2()

      expect(result).toBe(false)
      expect(isProjectLoaded.value).toBe(false)
    })

    it('通用错误时回滚状态', async () => {
      vi.mocked(getV2FullConfig).mockRejectedValue(new Error('Network error'))

      const result = await loadOps.loadProjectFromV2()

      expect(result).toBe(false)
      expect(isProjectLoaded.value).toBe(false)
      expect(projectName.value).toBe('')
    })

    it('更新统计信息', async () => {
      const config = makeFullConfig()
      config.manifest.schemas = [{ id: 's1' }] as any
      config.manifest.constraints = [{ id: 'c1' }] as any
      config.manifest.regex_nodes = [{ id: 'r1' }] as any
      config.manifest.transforms = [{ id: 't1' }] as any
      vi.mocked(getV2FullConfig).mockResolvedValue(config as any)
      vi.mocked(getV2ProjectView).mockResolvedValue({} as any)

      await loadOps.loadProjectFromV2()

      expect(projectConfigStats.value.schemaCount).toBe(1)
      expect(projectConfigStats.value.regexCount).toBe(1)
      expect(projectConfigStats.value.transformCount).toBe(1)
      expect(projectConfigStatsLoaded.value).toBe(true)
    })

    it('警告信息通过 toast 显示', async () => {
      const config = makeFullConfig()
      config.manifest.warnings = ['warning1', 'warning2']
      vi.mocked(getV2FullConfig).mockResolvedValue(config as any)
      vi.mocked(getV2ProjectView).mockResolvedValue({} as any)

      await loadOps.loadProjectFromV2()

      const { toastWarning } = await import('@/core/toast')
      expect(toastWarning).toHaveBeenCalledTimes(2)
    })

    it('恢复视图位置', async () => {
      vi.mocked(getV2FullConfig).mockResolvedValue(makeFullConfig() as any)
      vi.mocked(getV2ProjectView).mockResolvedValue({
        nodes: { 'project-root': { x: 200, y: 300 } },
      } as any)

      await loadOps.loadProjectFromV2()

      expect(nodes.value[0].position).toEqual({ x: 200, y: 300 })
    })

    it('视图加载失败不阻止主流程', async () => {
      vi.mocked(getV2FullConfig).mockResolvedValue(makeFullConfig() as any)
      vi.mocked(getV2ProjectView).mockRejectedValue(new Error('view error'))

      const result = await loadOps.loadProjectFromV2()

      expect(result).toBe(true)
    })

    it('重置 validation 状态', async () => {
      lastFullValidationSummary.value = { total: 1 } as any
      lastFullValidationStatistics.value = { count: 1 } as any
      vi.mocked(getV2FullConfig).mockResolvedValue(makeFullConfig() as any)
      vi.mocked(getV2ProjectView).mockResolvedValue({} as any)

      await loadOps.loadProjectFromV2()

      expect(lastFullValidationSummary.value).toBeNull()
      expect(lastFullValidationStatistics.value).toBeNull()
    })
  })
})
