import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  isElectron,
  getElectronAPI,
  ensureElectron,
  getPlatform,
  checkFileExists,
  showOpenDialog,
  scanDirectory,
  openFile,
  getServerStatus,
  getBackendPort,
  restartPythonServer,
  getAppVersion,
  getUserDataPath,
  getCwd,
  readFile,
  writeFile,
} from '@/core/utils/electronDetector'

describe('electron environment detection', () => {
  const g = globalThis as unknown as Record<string, unknown>
  const originalElectronAPI = (g.window as Record<string, unknown> | undefined)?.electronAPI

  beforeEach(() => {
    delete (g as Record<string, unknown>).window
    ;(g as Record<string, unknown>).window = {} as unknown as Record<string, unknown>
  })

  afterEach(() => {
    const w = (g as Record<string, unknown>).window as Record<string, unknown> | undefined
    if (originalElectronAPI) {
      if (w) w.electronAPI = originalElectronAPI
    } else {
      if (w) delete w.electronAPI
    }
  })

  describe('isElectron', () => {
    it('returns false when electronAPI is absent', () => {
      const w = (globalThis as unknown as Record<string, unknown>).window as
        | Record<string, unknown>
        | undefined
      if (w) delete w.electronAPI
      expect(isElectron()).toBe(false)
    })
    it('returns true when electronAPI is present', () => {
      const w = (globalThis as unknown as Record<string, unknown>).window as
        | Record<string, unknown>
        | undefined
      if (w) w.electronAPI = { platform: 'win32' } as unknown as Record<string, unknown>
      expect(isElectron()).toBe(true)
    })
  })

  describe('getElectronAPI', () => {
    it('throws when not in Electron environment', () => {
      const w = (globalThis as unknown as Record<string, unknown>).window as
        | Record<string, unknown>
        | undefined
      if (w) delete w.electronAPI
      expect(() => getElectronAPI()).toThrow('Electron API 不可用')
    })
    it('returns API when in Electron environment', () => {
      const mockApi = { platform: 'darwin' }
      const w = (globalThis as unknown as Record<string, unknown>).window as
        | Record<string, unknown>
        | undefined
      if (w) w.electronAPI = mockApi as unknown as Record<string, unknown>
      expect(getElectronAPI()).toBe(mockApi)
    })
  })

  describe('ensureElectron', () => {
    it('throws with helpful message when not in Electron', () => {
      const w = (globalThis as unknown as Record<string, unknown>).window as
        | Record<string, unknown>
        | undefined
      if (w) delete w.electronAPI
      expect(() => ensureElectron()).toThrow('此功能仅支持 Electron 桌面版')
    })
    it('does not throw when in Electron environment', () => {
      const w = (globalThis as unknown as Record<string, unknown>).window as
        | Record<string, unknown>
        | undefined
      if (w) w.electronAPI = { platform: 'linux' } as unknown as Record<string, unknown>
      expect(() => ensureElectron()).not.toThrow()
    })
  })

  describe('getPlatform', () => {
    it('returns platform from electronAPI', () => {
      const w = (globalThis as unknown as Record<string, unknown>).window as
        | Record<string, unknown>
        | undefined
      if (w) w.electronAPI = { platform: 'win32' } as unknown as Record<string, unknown>
      expect(getPlatform()).toBe('win32')
    })
    it('throws when not in Electron environment', () => {
      const w = (globalThis as unknown as Record<string, unknown>).window as
        | Record<string, unknown>
        | undefined
      if (w) delete w.electronAPI
      expect(() => getPlatform()).toThrow('此功能仅支持 Electron 桌面版')
    })
  })

  describe('async electron functions', () => {
    function setupMockApi(mockApi: Record<string, unknown>) {
      const w = (globalThis as unknown as Record<string, unknown>).window as
        | Record<string, unknown>
        | undefined
      if (w) w.electronAPI = mockApi
    }

    it('checkFileExists delegates to electronAPI', async () => {
      setupMockApi({ checkFileExists: async () => true })
      const result = await checkFileExists('/some/path')
      expect(result).toBe(true)
    })

    it('showOpenDialog returns normalized result', async () => {
      setupMockApi({ showOpenDialog: async () => ({ canceled: false, filePaths: ['/a', '/b'] }) })
      const result = await showOpenDialog({ title: 'Select' })
      expect(result.canceled).toBe(false)
      expect(result.filePaths).toEqual(['/a', '/b'])
    })

    it('showOpenDialog handles missing filePaths', async () => {
      setupMockApi({ showOpenDialog: async () => ({ canceled: true }) })
      const result = await showOpenDialog()
      expect(result.canceled).toBe(true)
      expect(result.filePaths).toEqual([])
    })

    it('scanDirectory delegates to electronAPI', async () => {
      setupMockApi({ scanDirectory: async () => ['file1.csv', 'file2.csv'] })
      const result = await scanDirectory('/dir', ['.csv'])
      expect(result).toEqual(['file1.csv', 'file2.csv'])
    })

    it('openFile delegates to electronAPI', async () => {
      setupMockApi({ openFile: async () => ({ success: true }) })
      const result = await openFile('/file.txt')
      expect(result.success).toBe(true)
    })

    it('getServerStatus delegates to electronAPI', async () => {
      setupMockApi({ getServerStatus: async () => ({ pythonReady: true, port: 8000 }) })
      const result = await getServerStatus()
      expect(result.pythonReady).toBe(true)
      expect(result.port).toBe(8000)
    })

    it('getBackendPort extracts port from status', async () => {
      setupMockApi({ getServerStatus: async () => ({ pythonReady: true, port: 9000 }) })
      const port = await getBackendPort()
      expect(port).toBe(9000)
    })

    it('restartPythonServer returns ready status', async () => {
      setupMockApi({ restartPythonServer: async () => ({ ready: true }) })
      const result = await restartPythonServer()
      expect(result).toBe(true)
    })

    it('getAppVersion delegates to electronAPI', async () => {
      setupMockApi({ getAppVersion: async () => '1.2.3' })
      const version = await getAppVersion()
      expect(version).toBe('1.2.3')
    })

    it('getUserDataPath delegates to electronAPI', async () => {
      setupMockApi({ getUserDataPath: async () => '/appdata' })
      const path = await getUserDataPath()
      expect(path).toBe('/appdata')
    })

    it('getCwd delegates to electronAPI', async () => {
      setupMockApi({ getCwd: async () => '/cwd' })
      const path = await getCwd()
      expect(path).toBe('/cwd')
    })

    it('readFile delegates to electronAPI', async () => {
      setupMockApi({ readFile: async () => 'content' })
      const content = await readFile('/file.txt')
      expect(content).toBe('content')
    })

    it('writeFile delegates to electronAPI', async () => {
      setupMockApi({ writeFile: async () => true })
      const result = await writeFile('/file.txt', 'hello')
      expect(result).toBe(true)
    })

    it('async functions throw when not in Electron', async () => {
      const w = (globalThis as unknown as Record<string, unknown>).window as
        | Record<string, unknown>
        | undefined
      if (w) delete w.electronAPI
      await expect(checkFileExists('/x')).rejects.toThrow('此功能仅支持 Electron')
      await expect(showOpenDialog()).rejects.toThrow('此功能仅支持 Electron')
      await expect(scanDirectory('/x')).rejects.toThrow('此功能仅支持 Electron')
      await expect(openFile('/x')).rejects.toThrow('此功能仅支持 Electron')
      await expect(getServerStatus()).rejects.toThrow('此功能仅支持 Electron')
      await expect(getBackendPort()).rejects.toThrow('此功能仅支持 Electron')
      await expect(restartPythonServer()).rejects.toThrow('此功能仅支持 Electron')
      await expect(getAppVersion()).rejects.toThrow('此功能仅支持 Electron')
      await expect(getUserDataPath()).rejects.toThrow('此功能仅支持 Electron')
      await expect(getCwd()).rejects.toThrow('此功能仅支持 Electron')
      await expect(readFile('/x')).rejects.toThrow('此功能仅支持 Electron')
      await expect(writeFile('/x', 'c')).rejects.toThrow('此功能仅支持 Electron')
    })
  })
})
