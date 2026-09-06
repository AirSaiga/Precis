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
import { describe, it, expect, beforeEach } from 'vitest'
import { useGlobalConfirm } from '@/composables/useGlobalConfirm'

describe('useGlobalConfirm', () => {
  beforeEach(() => {
    const { handleCancel } = useGlobalConfirm()
    handleCancel()
  })

  it('showConfirm with string message sets options and visible', async () => {
    const { visible, options, showConfirm } = useGlobalConfirm()
    const promise = showConfirm('Are you sure?')
    expect(visible.value).toBe(true)
    expect(options.value.message).toBe('Are you sure?')
    expect(options.value.type).toBe('info')
    const { handleConfirm } = useGlobalConfirm()
    handleConfirm()
    const result = await promise
    expect(result).toBe(true)
  })

  it('showConfirm with options object uses custom values', async () => {
    const { visible, options, showConfirm } = useGlobalConfirm()
    const promise = showConfirm({
      title: 'Delete',
      message: 'Delete this?',
      confirmText: 'Yes',
      cancelText: 'No',
      type: 'warning',
      allowHtml: true,
      alternativeText: 'Skip',
    })
    expect(visible.value).toBe(true)
    expect(options.value.title).toBe('Delete')
    expect(options.value.message).toBe('Delete this?')
    expect(options.value.confirmText).toBe('Yes')
    expect(options.value.cancelText).toBe('No')
    expect(options.value.type).toBe('warning')
    expect(options.value.allowHtml).toBe(true)
    expect(options.value.alternativeText).toBe('Skip')
    const { handleConfirm } = useGlobalConfirm()
    handleConfirm()
    await promise
  })

  it('handleConfirm resolves promise to true and hides dialog', async () => {
    const { showConfirm, visible, handleConfirm } = useGlobalConfirm()
    const promise = showConfirm('Test')
    handleConfirm()
    const result = await promise
    expect(result).toBe(true)
    expect(visible.value).toBe(false)
  })

  it('handleCancel resolves promise to false and hides dialog', async () => {
    const { showConfirm, visible, handleCancel } = useGlobalConfirm()
    const promise = showConfirm('Test')
    handleCancel()
    const result = await promise
    expect(result).toBe(false)
    expect(visible.value).toBe(false)
  })

  it('handleAlternative resolves promise to alternative and hides dialog', async () => {
    const { showConfirm, visible, handleAlternative } = useGlobalConfirm()
    const promise = showConfirm('Test')
    handleAlternative()
    const result = await promise
    expect(result).toBe('alternative')
    expect(visible.value).toBe(false)
  })

  it('showConfirm with partial options fills defaults', async () => {
    const { options, showConfirm } = useGlobalConfirm()
    const promise = showConfirm({ message: 'Only message' })
    expect(options.value.message).toBe('Only message')
    expect(options.value.title).toBeDefined()
    expect(options.value.confirmText).toBeDefined()
    const { handleConfirm } = useGlobalConfirm()
    handleConfirm()
    await promise
  })
})
