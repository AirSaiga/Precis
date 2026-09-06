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
