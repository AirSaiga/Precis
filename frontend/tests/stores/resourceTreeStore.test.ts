import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useResourceTreeStore } from '@/stores/resourceTreeStore'
import type { ResourceItem } from '@/types/resource'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('@/services/resourceService', () => ({
  resourceService: {
    loadFullConfig: vi.fn(),
    parseResources: vi.fn(),
  },
}))

vi.mock('@/core/toast', () => ({
  toastWarning: vi.fn(),
}))

import { resourceService } from '@/services/resourceService'

function makeConstraintResource(id: string, source: 'independent' | 'embedded'): ResourceItem {
  return {
    id,
    name: id,
    kind: 'constraint',
    constraintType: 'notNull',
    constraintSource: source,
  } as ResourceItem
}

function makeSchemaResource(id: string): ResourceItem {
  return {
    id,
    name: id,
    kind: 'schema',
  } as ResourceItem
}

describe('resourceTreeStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(resourceService.loadFullConfig).mockReset()
    vi.mocked(resourceService.parseResources).mockReset()
  })

  it('按 constraintSource 区分独立约束与内嵌约束', async () => {
    vi.mocked(resourceService.parseResources).mockReturnValue([
      makeConstraintResource('c1', 'independent'),
      makeConstraintResource('c2', 'embedded'),
      makeConstraintResource('c3', 'independent'),
      makeSchemaResource('s1'),
    ])
    vi.mocked(resourceService.loadFullConfig).mockResolvedValue({} as any)

    const store = useResourceTreeStore()
    await store.loadResources('/project')

    expect(store.independentConstraints).toHaveLength(2)
    expect(store.independentConstraints.map((r) => r.id)).toEqual(['c1', 'c3'])
    expect(store.embeddedConstraints).toHaveLength(1)
    expect(store.embeddedConstraints[0].id).toBe('c2')
  })

  it('getResourcesByFolderType 仅返回独立约束', async () => {
    vi.mocked(resourceService.parseResources).mockReturnValue([
      makeConstraintResource('c1', 'independent'),
      makeConstraintResource('c2', 'embedded'),
      makeSchemaResource('s1'),
    ])
    vi.mocked(resourceService.loadFullConfig).mockResolvedValue({} as any)

    const store = useResourceTreeStore()
    await store.loadResources('/project')

    const result = store.getResourcesByFolderType('independentConstraints')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('c1')
  })

  it('loadResources 使用独立约束计数更新文件夹', async () => {
    vi.mocked(resourceService.parseResources).mockReturnValue([
      makeConstraintResource('c1', 'independent'),
      makeConstraintResource('c2', 'embedded'),
      makeConstraintResource('c3', 'independent'),
    ])
    vi.mocked(resourceService.loadFullConfig).mockResolvedValue({} as any)

    const store = useResourceTreeStore()
    await store.loadResources('/project')

    expect(store.folders.validationAssets.children?.[0]?.count).toBe(2)
  })
})
