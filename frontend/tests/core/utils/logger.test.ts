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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { logger } from '@/core/utils/logger'

describe('logger', () => {
  let debugSpy: ReturnType<typeof vi.spyOn>
  let infoSpy: ReturnType<typeof vi.spyOn>
  let warnSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('logs debug messages with timestamp prefix', () => {
    logger.debug('test message')
    expect(debugSpy).toHaveBeenCalledOnce()
    expect(debugSpy.mock.calls[0][0]).toMatch(/\[.+\] \[DEBUG\] test message/)
  })

  it('logs info messages', () => {
    logger.info('info message')
    expect(infoSpy).toHaveBeenCalledOnce()
    expect(infoSpy.mock.calls[0][0]).toMatch(/\[.+\] \[INFO\] info message/)
  })

  it('logs warn messages', () => {
    logger.warn('warn message')
    expect(warnSpy).toHaveBeenCalledOnce()
    expect(warnSpy.mock.calls[0][0]).toMatch(/\[.+\] \[WARN\] warn message/)
  })

  it('logs error messages', () => {
    logger.error('error message')
    expect(errorSpy).toHaveBeenCalledOnce()
    expect(errorSpy.mock.calls[0][0]).toMatch(/\[.+\] \[ERROR\] error message/)
  })

  it('passes extra arguments to console', () => {
    logger.debug('message', { key: 'value' })
    expect(debugSpy).toHaveBeenCalledOnce()
    expect(debugSpy.mock.calls[0][1]).toEqual({ key: 'value' })
  })
})
