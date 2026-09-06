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
import { beforeEach, describe, expect, it, vi } from 'vitest'

const saveProjectMock = vi.fn()

vi.mock('@/stores/graphStore', () => ({
  useGraphStore: () => ({ saveProject: saveProjectMock }),
}))

import { save } from '@/features/keyboard/handlers/editor/save'

describe('editor save handler — saveProject 布尔结果传播', () => {
  beforeEach(() => {
    saveProjectMock.mockReset()
  })

  it('saveProject 返回 true 时报告成功', async () => {
    saveProjectMock.mockResolvedValue(true)
    const r = await save()
    expect(r.success).toBe(true)
    expect(r.message).toBe('shortcuts.feedback.saved')
  })

  it('saveProject 返回 false（预校验 BLOCKER）时报告失败，而非假阳性"已保存"', async () => {
    saveProjectMock.mockResolvedValue(false)
    const r = await save()
    expect(r.success).toBe(false)
    expect(r.message).toBe('shortcuts.feedback.saveFailed')
  })

  it('saveProject 抛异常时报告失败', async () => {
    saveProjectMock.mockRejectedValue(new Error('boom'))
    const r = await save()
    expect(r.success).toBe(false)
    expect(r.message).toBe('shortcuts.feedback.saveFailed')
  })
})
