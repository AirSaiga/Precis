import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, type Ref } from 'vue'

vi.mock('@/api/projectV2Api', () => ({
  getV2FullConfig: vi.fn(),
}))

vi.mock('@/utils/constraintCount', () => ({
  calculateConstraintStatsFromManifest: vi.fn(),
}))

vi.mock('@/core/utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import { getV2FullConfig } from '@/api/projectV2Api'
import { calculateConstraintStatsFromManifest } from '@/utils/constraintCount'
import { createV2StatsOps } from '@/stores/graphStore/modules/v2/persistence/stats'

describe('createV2StatsOps', () => {
  let projectConfigStats: Ref<{
    schemaCount: number
    constraintCount: number
    constraintStandaloneCount: number
    constraintInlineCount: number
    regexCount: number
    transformCount: number
    templateCount: number
  }>
  let projectConfigStatsLoaded: Ref<boolean>
  let projectConfigStatsConfigPath: Ref<string>
  let ops: ReturnType<typeof createV2StatsOps>

  beforeEach(() => {
    projectConfigStats = ref({
      schemaCount: 0,
      constraintCount: 0,
      constraintStandaloneCount: 0,
      constraintInlineCount: 0,
      regexCount: 0,
      transformCount: 0,
      templateCount: 0,
    })
    projectConfigStatsLoaded = ref(false)
    projectConfigStatsConfigPath = ref('')

    ops = createV2StatsOps({
      projectConfigStats,
      projectConfigStatsLoaded,
      projectConfigStatsConfigPath,
      normalizeConfigDir: (p: string) => p.replace(/[/\\]+$/, ''),
      getEffectiveProjectConfigPath: () => '/project',
    })

    vi.mocked(getV2FullConfig).mockClear()
    vi.mocked(calculateConstraintStatsFromManifest).mockClear()
  })

  describe('refreshProjectConfigStats', () => {
    it('成功加载并更新统计', async () => {
      vi.mocked(getV2FullConfig).mockResolvedValue({
        manifest: {
          schemas: [{ id: 's1' }],
          constraints: [{ id: 'c1' }],
          regex_nodes: [{ id: 'r1' }],
          transforms: [{ id: 't1' }],
          templates: [],
        },
        schemas: {},
      } as any)

      vi.mocked(calculateConstraintStatsFromManifest).mockReturnValue({
        total: 5,
        standalone: 3,
        inline: 2,
      })

      const result = await ops.refreshProjectConfigStats('/project')

      expect(result).toBe(true)
      expect(projectConfigStats.value.schemaCount).toBe(1)
      expect(projectConfigStats.value.constraintCount).toBe(5)
      expect(projectConfigStats.value.constraintStandaloneCount).toBe(3)
      expect(projectConfigStats.value.constraintInlineCount).toBe(2)
      expect(projectConfigStats.value.regexCount).toBe(1)
      expect(projectConfigStats.value.transformCount).toBe(1)
      expect(projectConfigStatsLoaded.value).toBe(true)
    })

    it('已加载相同路径时跳过', async () => {
      projectConfigStatsLoaded.value = true
      projectConfigStatsConfigPath.value = '/project'

      const result = await ops.refreshProjectConfigStats('/project')

      expect(result).toBe(true)
      expect(getV2FullConfig).not.toHaveBeenCalled()
    })

    it('无配置路径时返回 false', async () => {
      const opsNoPath = createV2StatsOps({
        projectConfigStats,
        projectConfigStatsLoaded,
        projectConfigStatsConfigPath,
        normalizeConfigDir: (p: string) => p,
        getEffectiveProjectConfigPath: () => undefined,
      })

      const result = await opsNoPath.refreshProjectConfigStats()
      expect(result).toBe(false)
    })

    it('API 失败时返回 false 并标记未加载', async () => {
      vi.mocked(getV2FullConfig).mockRejectedValue(new Error('Network error'))

      const result = await ops.refreshProjectConfigStats('/project')

      expect(result).toBe(false)
      expect(projectConfigStatsLoaded.value).toBe(false)
    })
  })
})
