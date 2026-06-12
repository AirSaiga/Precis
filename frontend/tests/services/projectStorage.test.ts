import { describe, it, expect, beforeEach, vi } from 'vitest'

describe('ProjectStorageService', () => {
  let ProjectStorageService: any
  let service: any

  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('localStorage', {
      _data: {} as Record<string, string>,
      getItem(key: string) {
        return this._data[key] ?? null
      },
      setItem(key: string, value: string) {
        this._data[key] = value
      },
      removeItem(key: string) {
        delete this._data[key]
      },
    })
    vi.stubGlobal('logger', { warn: vi.fn(), error: vi.fn() })
    vi.doMock('@/core/utils/logger', () => ({
      logger: { warn: vi.fn(), error: vi.fn() },
    }))
  })

  async function getService() {
    const mod = await import('@/services/projectStorage')
    return mod.projectStorageService
  }

  function makeProject(overrides?: Record<string, unknown>) {
    return {
      name: 'Test Project',
      path: '/test/project',
      lastOpened: Date.now(),
      ...overrides,
    }
  }

  describe('getRecentProjects', () => {
    it('初始状态返回空数组', async () => {
      const svc = await getService()
      expect(svc.getRecentProjects()).toEqual([])
    })

    it('返回已存储的项目列表', async () => {
      const svc = await getService()
      const proj = makeProject()
      svc.addRecentProject(proj)
      const projects = svc.getRecentProjects()
      expect(projects).toHaveLength(1)
      expect(projects[0].name).toBe('Test Project')
    })

    it('损坏的数据返回空数组', async () => {
      localStorage.setItem('recentProjects', 'invalid-json')
      const svc = await getService()
      expect(svc.getRecentProjects()).toEqual([])
    })

    it('非数组数据返回空数组', async () => {
      localStorage.setItem('recentProjects', JSON.stringify({ foo: 'bar' }))
      const svc = await getService()
      expect(svc.getRecentProjects()).toEqual([])
    })

    it('过滤无效项目', async () => {
      localStorage.setItem(
        'recentProjects',
        JSON.stringify([
          { name: 'Valid', path: '/valid', lastOpened: 100 },
          { name: '', path: '', lastOpened: 'invalid' },
        ])
      )
      const svc = await getService()
      const projects = svc.getRecentProjects()
      expect(projects).toHaveLength(1)
      expect(projects[0].name).toBe('Valid')
    })
  })

  describe('addRecentProject', () => {
    it('添加新项目到列表', async () => {
      const svc = await getService()
      svc.addRecentProject(makeProject({ name: 'Project A' }))
      const projects = svc.getRecentProjects()
      expect(projects).toHaveLength(1)
      expect(projects[0].name).toBe('Project A')
    })

    it('更新已存在项目的时间戳', async () => {
      const svc = await getService()
      svc.addRecentProject(makeProject({ name: 'Project A', lastOpened: 100 }))
      svc.addRecentProject(makeProject({ name: 'Project A Updated', lastOpened: 200 }))
      const projects = svc.getRecentProjects()
      expect(projects).toHaveLength(1)
      expect(projects[0].name).toBe('Project A Updated')
      expect(projects[0].lastOpened).toBe(200)
    })

    it('超过 10 个时移除最早的', async () => {
      const svc = await getService()
      for (let i = 0; i < 15; i++) {
        svc.addRecentProject(
          makeProject({ name: `Project ${i}`, path: `/path/${i}`, lastOpened: i * 100 })
        )
      }
      const projects = svc.getRecentProjects()
      expect(projects.length).toBeLessThanOrEqual(10)
    })

    it('新项目没有 createdAt 时自动生成', async () => {
      const svc = await getService()
      const before = Date.now()
      svc.addRecentProject(makeProject({ createdAt: undefined }))
      const projects = svc.getRecentProjects()
      expect(projects[0].createdAt).toBeGreaterThanOrEqual(before)
    })
  })

  describe('removeRecentProject', () => {
    it('根据路径移除项目', async () => {
      const svc = await getService()
      svc.addRecentProject(makeProject({ path: '/keep', name: 'Keep' }))
      svc.addRecentProject(makeProject({ path: '/remove', name: 'Remove' }))
      svc.removeRecentProject('/remove')
      const projects = svc.getRecentProjects()
      expect(projects).toHaveLength(1)
      expect(projects[0].name).toBe('Keep')
    })

    it('路径不存在时不影响列表', async () => {
      const svc = await getService()
      svc.addRecentProject(makeProject())
      svc.removeRecentProject('/nonexistent')
      expect(svc.getRecentProjects()).toHaveLength(1)
    })
  })

  describe('clearRecentProjects', () => {
    it('清空所有项目', async () => {
      const svc = await getService()
      svc.addRecentProject(makeProject())
      svc.clearRecentProjects()
      expect(svc.getRecentProjects()).toEqual([])
    })
  })

  describe('getProjectByPath', () => {
    it('找到对应项目', async () => {
      const svc = await getService()
      svc.addRecentProject(makeProject({ name: 'Target', path: '/target' }))
      const found = svc.getProjectByPath('/target')
      expect(found.name).toBe('Target')
    })

    it('路径不匹配返回 undefined', async () => {
      const svc = await getService()
      svc.addRecentProject(makeProject({ path: '/a' }))
      expect(svc.getProjectByPath('/b')).toBeUndefined()
    })
  })

  describe('updateProject', () => {
    it('更新存在的项目', async () => {
      const svc = await getService()
      svc.addRecentProject(makeProject({ name: 'Old', path: '/p' }))
      const result = svc.updateProject('/p', { name: 'New' })
      expect(result).toBe(true)
      expect(svc.getProjectByPath('/p').name).toBe('New')
    })

    it('项目不存在返回 false', async () => {
      const svc = await getService()
      expect(svc.updateProject('/nonexistent', { name: 'X' })).toBe(false)
    })
  })
})
