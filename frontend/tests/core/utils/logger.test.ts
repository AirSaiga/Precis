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
