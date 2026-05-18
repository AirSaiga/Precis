import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useToast, isToastAvailable } from '@/composables/shared/useToast'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

describe('useToast', () => {
  beforeEach(() => {
    delete (window as unknown as { $toast?: unknown }).$toast
    vi.restoreAllMocks()
  })

  it('calls window.$toast.success when available', () => {
    const successMock = vi.fn()
    ;(window as unknown as { $toast?: unknown }).$toast = {
      success: successMock,
      error: vi.fn(),
      warning: vi.fn(),
      info: vi.fn(),
    }
    const { success } = useToast()
    success('msg', 'title')
    expect(successMock).toHaveBeenCalledWith('title', 'msg')
  })

  it('calls window.$toast.error when available', () => {
    const errorMock = vi.fn()
    ;(window as unknown as { $toast?: unknown }).$toast = {
      success: vi.fn(),
      error: errorMock,
      warning: vi.fn(),
      info: vi.fn(),
    }
    const { error } = useToast()
    error('err', 'title')
    expect(errorMock).toHaveBeenCalledWith('title', 'err')
  })

  it('calls window.$toast.warning when available', () => {
    const warningMock = vi.fn()
    ;(window as unknown as { $toast?: unknown }).$toast = {
      success: vi.fn(),
      error: vi.fn(),
      warning: warningMock,
      info: vi.fn(),
    }
    const { warning } = useToast()
    warning('warn')
    expect(warningMock).toHaveBeenCalledWith('common.warning', 'warn')
  })

  it('calls window.$toast.info when available', () => {
    const infoMock = vi.fn()
    ;(window as unknown as { $toast?: unknown }).$toast = {
      success: vi.fn(),
      error: vi.fn(),
      warning: vi.fn(),
      info: infoMock,
    }
    const { info } = useToast()
    info('info')
    expect(infoMock).toHaveBeenCalledWith('common.info', 'info')
  })

  it('falls back to console debug when $toast unavailable', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const { success } = useToast()
    success('msg', 'title')
    expect(debugSpy).toHaveBeenCalled()
    debugSpy.mockRestore()
  })

  it('isToastAvailable returns true when $toast exists', () => {
    ;(window as unknown as { $toast?: unknown }).$toast = { success: vi.fn() }
    expect(isToastAvailable()).toBe(true)
  })

  it('isToastAvailable returns false when $toast missing', () => {
    delete (window as unknown as { $toast?: unknown }).$toast
    expect(isToastAvailable()).toBe(false)
  })
})
