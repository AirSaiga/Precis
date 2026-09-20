/*
 * SPDX-License-Identifier: Apache-2.0
 *
 * Copyright 2026 Precis Team
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/**
 * @fileoverview workspaceStore 单元测试
 *
 * 重点回归（画布成为唯一首屏）：
 * - loadConfig 在无激活项目时跳过（不发请求，避免 422 报错噪音）
 * - 有激活项目时正常调用 API 加载配置
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { useProjectStore } from '@/stores/projectStore'
import { getWorkspaceConfig } from '@/api/workspaceApi'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
  createI18n: () => ({ global: { t: (key: string) => key } }),
}))

vi.mock('@/api/workspaceApi', () => ({
  getWorkspaceConfig: vi.fn(),
  saveWorkspaceConfig: vi.fn(),
  updateWorkspaceConfig: vi.fn(),
}))

const mockedGet = vi.mocked(getWorkspaceConfig)

describe('workspaceStore.loadConfig 项目守卫', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('无激活项目时跳过加载（不发请求）', async () => {
    const store = useWorkspaceStore()
    expect(useProjectStore().isProjectActive).toBe(false)

    await store.loadConfig()

    expect(mockedGet).not.toHaveBeenCalled()
  })

  it('有激活项目时正常加载配置', async () => {
    // 后端格式：data_sources；service 负责转换为前端 recent_data_sources
    mockedGet.mockResolvedValue({
      data_sources: [{ id: 'ds1', name: 'a.csv', fileId: '/a.csv', status: 'ready' }],
    } as never)

    useProjectStore().setProjectPaths({
      configPath: 'D:/proj/demo',
      dataPath: 'D:/proj/demo',
    })
    const store = useWorkspaceStore()

    await store.loadConfig()

    expect(mockedGet).toHaveBeenCalledTimes(1)
    expect(store.config.recent_data_sources).toHaveLength(1)
  })
})

describe('workspaceStore.addDataSource 查重口径（§3.1 存储 toPosixPath × 比较双侧 normalizePath）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    vi.clearAllMocks()
  })

  // 2026-09-20 修复回归：§3.1 存储层改 toPosixPath（保留大小写）后比较侧未同步，
  // Windows 大写盘符路径四路交叉比较恒不命中——同一路径重复导入恒走追加。
  const absPath = process.platform === 'win32' ? 'D:/Data/File.csv' : '/data/File.csv'

  function seedStore(store: ReturnType<typeof useWorkspaceStore>) {
    store.config.recent_data_sources = [
      {
        id: 'seed-1',
        name: 'File.csv',
        fileId: absPath, // §3.1 后存储格式（toPosixPath，保留大小写）
        type: 'csv',
        status: 'ready',
        addedAt: '2026-09-20T00:00:00Z',
        lastUsed: '2026-09-20T00:00:00Z',
        sourceMode: 'localfile',
        localPath: absPath,
        folderPath: undefined,
        size: 123,
      },
    ]
  }

  it('同一路径重复导入：合并既有条目而非追加', async () => {
    const store = useWorkspaceStore()
    seedStore(store)

    const returnedId = await store.addDataSource(absPath, 'File.csv', 'csv')

    expect(store.config.recent_data_sources).toHaveLength(1)
    expect(store.config.recent_data_sources[0].id).toBe('seed-1')
    expect(returnedId).toBe('seed-1')
  })

  it('不同路径导入：正常追加新条目', async () => {
    const store = useWorkspaceStore()
    seedStore(store)

    const other = process.platform === 'win32' ? 'D:/Data/Other.csv' : '/data/Other.csv'
    await store.addDataSource(other, 'Other.csv', 'csv')

    expect(store.config.recent_data_sources).toHaveLength(2)
  })
})
