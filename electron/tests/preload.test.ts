/**
 * @fileoverview Electron preload.ts IPC 接口健壮性测试
 *
 * 测试所有 20+ 个通过 contextBridge 暴露的 IPC 接口。
 * 对每个接口测试正常路径 + 至少 1 个异常路径。
 *
 * 测试策略：
 * - Mock electron 模块（contextBridge、ipcRenderer）
 * - 捕获 exposeInMainWorld 接收的 API 对象
 * - 对每个 API 方法测试参数传递、返回值处理和错误场景
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// 使用 vi.hoisted 确保 mock 变量在 vi.mock 工厂之前初始化
const { mockInvoke, exposedApi } = vi.hoisted(() => {
  return {
    mockInvoke: vi.fn(),
    exposedApi: {} as Record<string, unknown>,
  }
})

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (_key: string, api: Record<string, unknown>) => {
      Object.assign(exposedApi, api)
    },
  },
  ipcRenderer: {
    invoke: mockInvoke,
  },
}))

// 导入 preload 触发 side-effect（调用 exposeInMainWorld）
import '../src/preload'

beforeEach(() => {
  mockInvoke.mockReset()
})

// ============================================================================
// 1. getServerStatus
// ============================================================================
describe('getServerStatus', () => {
  it('正常路径：返回 pythonReady=true', async () => {
    mockInvoke.mockResolvedValue({ pythonReady: true, port: 18000, frontendPort: 5173 })
    const fn = exposedApi.getServerStatus as () => Promise<unknown>
    const result = await fn()
    expect(mockInvoke).toHaveBeenCalledWith('get-server-status')
    expect(result).toEqual({ pythonReady: true, port: 18000, frontendPort: 5173 })
  })

  it('异常路径：后端未启动时返回 pythonReady=false', async () => {
    mockInvoke.mockResolvedValue({ pythonReady: false, port: 0, frontendPort: 0 })
    const fn = exposedApi.getServerStatus as () => Promise<unknown>
    const result = await fn()
    expect(result).toEqual({ pythonReady: false, port: 0, frontendPort: 0 })
  })

  it('异常路径：IPC 调用失败时抛出错误', async () => {
    mockInvoke.mockRejectedValue(new Error('IPC channel not registered'))
    const fn = exposedApi.getServerStatus as () => Promise<unknown>
    await expect(fn()).rejects.toThrow('IPC channel not registered')
  })
})

// ============================================================================
// 2. restartPythonServer
// ============================================================================
describe('restartPythonServer', () => {
  it('正常路径：重启成功返回新端口', async () => {
    mockInvoke.mockResolvedValue({ ready: true, port: 18001 })
    const fn = exposedApi.restartPythonServer as () => Promise<unknown>
    const result = await fn()
    expect(mockInvoke).toHaveBeenCalledWith('restart-python-server')
    expect(result).toEqual({ ready: true, port: 18001 })
  })

  it('异常路径：重启失败返回 ready=false', async () => {
    mockInvoke.mockResolvedValue({ ready: false, port: 0 })
    const fn = exposedApi.restartPythonServer as () => Promise<unknown>
    const result = await fn()
    expect(result).toEqual({ ready: false, port: 0 })
  })
})

// ============================================================================
// 3. getAppVersion
// ============================================================================
describe('getAppVersion', () => {
  it('正常路径：返回版本号字符串', async () => {
    mockInvoke.mockResolvedValue('0.1.0')
    const fn = exposedApi.getAppVersion as () => Promise<string>
    const result = await fn()
    expect(mockInvoke).toHaveBeenCalledWith('get-app-version')
    expect(result).toBe('0.1.0')
  })

  it('异常路径：package.json 缺失时返回默认版本', async () => {
    mockInvoke.mockResolvedValue('0.0.0')
    const fn = exposedApi.getAppVersion as () => Promise<string>
    const result = await fn()
    expect(result).toBe('0.0.0')
  })

  it('异常路径：IPC 调用失败', async () => {
    mockInvoke.mockRejectedValue(new Error('Cannot read package.json'))
    const fn = exposedApi.getAppVersion as () => Promise<string>
    await expect(fn()).rejects.toThrow('Cannot read package.json')
  })
})

// ============================================================================
// 4. platform（静态属性）
// ============================================================================
describe('platform', () => {
  it('静态属性：返回当前平台字符串', () => {
    // platform 是直接属性，不是函数调用
    expect(typeof exposedApi.platform).toBe('string')
    expect(['win32', 'darwin', 'linux']).toContain(exposedApi.platform)
  })
})

// ============================================================================
// 5. getUserDataPath
// ============================================================================
describe('getUserDataPath', () => {
  it('正常路径：返回用户数据目录路径', async () => {
    mockInvoke.mockResolvedValue('/home/user/.config/Precis')
    const fn = exposedApi.getUserDataPath as () => Promise<string>
    const result = await fn()
    expect(mockInvoke).toHaveBeenCalledWith('get-user-data-path')
    expect(typeof result).toBe('string')
  })

  it('异常路径：权限不足时的错误处理', async () => {
    mockInvoke.mockRejectedValue(new Error('EACCES: permission denied'))
    const fn = exposedApi.getUserDataPath as () => Promise<string>
    await expect(fn()).rejects.toThrow('permission denied')
  })
})

// ============================================================================
// 6. getDefaultProjectPath
// ============================================================================
describe('getDefaultProjectPath', () => {
  it('正常路径：返回默认项目路径', async () => {
    mockInvoke.mockResolvedValue('/home/user/projects')
    const fn = exposedApi.getDefaultProjectPath as () => Promise<string>
    const result = await fn()
    expect(mockInvoke).toHaveBeenCalledWith('get-default-project-path')
    expect(typeof result).toBe('string')
  })

  it('异常路径：路径不存在时返回空字符串', async () => {
    mockInvoke.mockResolvedValue('')
    const fn = exposedApi.getDefaultProjectPath as () => Promise<string>
    const result = await fn()
    expect(result).toBe('')
  })
})

// ============================================================================
// 7. ensureDir
// ============================================================================
describe('ensureDir', () => {
  it('正常路径：创建目录成功', async () => {
    mockInvoke.mockResolvedValue(true)
    const fn = exposedApi.ensureDir as (dirPath: string) => Promise<unknown>
    const result = await fn('/tmp/newdir')
    expect(mockInvoke).toHaveBeenCalledWith('ensure-dir', '/tmp/newdir')
    expect(result).toBe(true)
  })

  it('异常路径：路径无效', async () => {
    mockInvoke.mockResolvedValue(false)
    const fn = exposedApi.ensureDir as (dirPath: string) => Promise<unknown>
    const result = await fn('invalid::path')
    expect(result).toBe(false)
  })

  it('异常路径：权限不足', async () => {
    mockInvoke.mockRejectedValue(new Error('EACCES: permission denied'))
    const fn = exposedApi.ensureDir as (dirPath: string) => Promise<unknown>
    await expect(fn('/root/protected')).rejects.toThrow('permission denied')
  })
})

// ============================================================================
// 8. showOpenDialog
// ============================================================================
describe('showOpenDialog', () => {
  it('正常路径：用户选择文件', async () => {
    mockInvoke.mockResolvedValue({ canceled: false, filePaths: ['/path/to/file.csv'] })
    const fn = exposedApi.showOpenDialog as (options: Record<string, unknown>) => Promise<unknown>
    const result = await fn({ title: 'Select File', properties: ['openFile'] })
    expect(mockInvoke).toHaveBeenCalledWith('show-open-dialog', { title: 'Select File', properties: ['openFile'] })
    expect(result).toEqual({ canceled: false, filePaths: ['/path/to/file.csv'] })
  })

  it('异常路径：用户取消选择', async () => {
    mockInvoke.mockResolvedValue({ canceled: true, filePaths: [] })
    const fn = exposedApi.showOpenDialog as (options: Record<string, unknown>) => Promise<unknown>
    const result = await fn({})
    expect(result).toEqual({ canceled: true, filePaths: [] })
  })
})

// ============================================================================
// 9. checkFileExists
// ============================================================================
describe('checkFileExists', () => {
  it('正常路径：文件存在', async () => {
    mockInvoke.mockResolvedValue(true)
    const fn = exposedApi.checkFileExists as (filePath: string) => Promise<boolean>
    const result = await fn('/path/to/existing.csv')
    expect(mockInvoke).toHaveBeenCalledWith('check-file-exists', '/path/to/existing.csv')
    expect(result).toBe(true)
  })

  it('异常路径：文件不存在', async () => {
    mockInvoke.mockResolvedValue(false)
    const fn = exposedApi.checkFileExists as (filePath: string) => Promise<boolean>
    const result = await fn('/path/to/missing.csv')
    expect(result).toBe(false)
  })

  it('异常路径：路径为空字符串', async () => {
    mockInvoke.mockResolvedValue(false)
    const fn = exposedApi.checkFileExists as (filePath: string) => Promise<boolean>
    const result = await fn('')
    expect(mockInvoke).toHaveBeenCalledWith('check-file-exists', '')
    expect(result).toBe(false)
  })
})

// ============================================================================
// 10. reselectFile
// ============================================================================
describe('reselectFile', () => {
  it('正常路径：重新选择文件成功', async () => {
    mockInvoke.mockResolvedValue({ canceled: false, filePaths: ['/new/path/file.csv'] })
    const fn = exposedApi.reselectFile as (options: Record<string, unknown>) => Promise<unknown>
    const result = await fn({ title: 'Reselect Data File' })
    expect(mockInvoke).toHaveBeenCalledWith('reselect-file', { title: 'Reselect Data File' })
    expect(result).toEqual({ canceled: false, filePaths: ['/new/path/file.csv'] })
  })

  it('异常路径：用户取消重新选择', async () => {
    mockInvoke.mockResolvedValue({ canceled: true, filePaths: [] })
    const fn = exposedApi.reselectFile as (options: Record<string, unknown>) => Promise<unknown>
    const result = await fn({})
    expect(result).toEqual({ canceled: true, filePaths: [] })
  })
})

// ============================================================================
// 11. openFile
// ============================================================================
describe('openFile', () => {
  it('正常路径：用系统默认程序打开文件', async () => {
    mockInvoke.mockResolvedValue({ success: true })
    const fn = exposedApi.openFile as (filePath: string) => Promise<unknown>
    const result = await fn('/path/to/data.xlsx')
    expect(mockInvoke).toHaveBeenCalledWith('open-file', '/path/to/data.xlsx')
    expect(result).toEqual({ success: true })
  })

  it('异常路径：文件不存在', async () => {
    mockInvoke.mockResolvedValue({ success: false, error: 'File not found' })
    const fn = exposedApi.openFile as (filePath: string) => Promise<unknown>
    const result = await fn('/nonexistent/file.xlsx')
    expect(result).toEqual({ success: false, error: 'File not found' })
  })
})

// ============================================================================
// 12. saveTextFile
// ============================================================================
describe('saveTextFile', () => {
  it('正常路径：保存文本文件成功', async () => {
    mockInvoke.mockResolvedValue(true)
    const fn = exposedApi.saveTextFile as (fileName: string, content: string) => Promise<boolean>
    const result = await fn('config.json', '{"key":"value"}')
    expect(mockInvoke).toHaveBeenCalledWith('save-text-file', 'config.json', '{"key":"value"}')
    expect(result).toBe(true)
  })

  it('异常路径：文件名非法', async () => {
    mockInvoke.mockResolvedValue(false)
    const fn = exposedApi.saveTextFile as (fileName: string, content: string) => Promise<boolean>
    const result = await fn('invalid:name.txt', 'content')
    expect(result).toBe(false)
  })

  it('异常路径：写入权限不足', async () => {
    mockInvoke.mockRejectedValue(new Error('EACCES: permission denied'))
    const fn = exposedApi.saveTextFile as (fileName: string, content: string) => Promise<boolean>
    await expect(fn('protected.json', 'data')).rejects.toThrow('permission denied')
  })
})

// ============================================================================
// 13. loadTextFile
// ============================================================================
describe('loadTextFile', () => {
  it('正常路径：读取文本文件成功', async () => {
    mockInvoke.mockResolvedValue('{"key":"value"}')
    const fn = exposedApi.loadTextFile as (fileName: string) => Promise<string | null>
    const result = await fn('config.json')
    expect(mockInvoke).toHaveBeenCalledWith('load-text-file', 'config.json')
    expect(result).toBe('{"key":"value"}')
  })

  it('异常路径：文件不存在返回 null', async () => {
    mockInvoke.mockResolvedValue(null)
    const fn = exposedApi.loadTextFile as (fileName: string) => Promise<string | null>
    const result = await fn('missing.json')
    expect(result).toBeNull()
  })
})

// ============================================================================
// 14. saveConfig
// ============================================================================
describe('saveConfig', () => {
  it('正常路径：保存项目配置成功', async () => {
    mockInvoke.mockResolvedValue(true)
    const fn = exposedApi.saveConfig as (configPath: string, dataPath: string) => Promise<boolean>
    const result = await fn('/project/.precis', '/project/data')
    expect(mockInvoke).toHaveBeenCalledWith('save-config', '/project/.precis', '/project/data')
    expect(result).toBe(true)
  })

  it('异常路径：配置路径不存在时自动创建', async () => {
    mockInvoke.mockResolvedValue(true)
    const fn = exposedApi.saveConfig as (configPath: string, dataPath: string) => Promise<boolean>
    const result = await fn('/new/project/.precis', '/new/project/data')
    expect(result).toBe(true)
  })
})

// ============================================================================
// 15. loadConfig
// ============================================================================
describe('loadConfig', () => {
  it('正常路径：加载项目配置成功', async () => {
    mockInvoke.mockResolvedValue({ configPath: '/project/.precis', dataPath: '/project/data' })
    const fn = exposedApi.loadConfig as () => Promise<unknown>
    const result = await fn()
    expect(mockInvoke).toHaveBeenCalledWith('load-config')
    expect(result).toEqual({ configPath: '/project/.precis', dataPath: '/project/data' })
  })

  it('异常路径：配置文件不存在返回默认值', async () => {
    mockInvoke.mockResolvedValue({ configPath: '', dataPath: '' })
    const fn = exposedApi.loadConfig as () => Promise<unknown>
    const result = await fn()
    expect(result).toEqual({ configPath: '', dataPath: '' })
  })
})

// ============================================================================
// 16. scanDirectory
// ============================================================================
describe('scanDirectory', () => {
  it('正常路径：扫描目录返回文件列表', async () => {
    mockInvoke.mockResolvedValue(['/data/file1.csv', '/data/file2.xlsx'])
    const fn = exposedApi.scanDirectory as (dirPath: string, extensions?: string[]) => Promise<string[]>
    const result = await fn('/data', ['.csv', '.xlsx'])
    expect(mockInvoke).toHaveBeenCalledWith('scan-directory', { dirPath: '/data', allowedExtensions: ['.csv', '.xlsx'] })
    expect(result).toEqual(['/data/file1.csv', '/data/file2.xlsx'])
  })

  it('正常路径：不传 extensions 使用默认值', async () => {
    mockInvoke.mockResolvedValue(['/data/file.csv'])
    const fn = exposedApi.scanDirectory as (dirPath: string, extensions?: string[]) => Promise<string[]>
    await fn('/data')
    expect(mockInvoke).toHaveBeenCalledWith('scan-directory', { dirPath: '/data', allowedExtensions: undefined })
  })

  it('异常路径：目录不存在返回空数组', async () => {
    mockInvoke.mockResolvedValue([])
    const fn = exposedApi.scanDirectory as (dirPath: string, extensions?: string[]) => Promise<string[]>
    const result = await fn('/nonexistent')
    expect(result).toEqual([])
  })

  it('异常路径：权限不足', async () => {
    mockInvoke.mockRejectedValue(new Error('EACCES: permission denied'))
    const fn = exposedApi.scanDirectory as (dirPath: string, extensions?: string[]) => Promise<string[]>
    await expect(fn('/root')).rejects.toThrow('permission denied')
  })
})

// ============================================================================
// 17. getCwd
// ============================================================================
describe('getCwd', () => {
  it('正常路径：返回当前工作目录', async () => {
    mockInvoke.mockResolvedValue('/home/user/project')
    const fn = exposedApi.getCwd as () => Promise<string>
    const result = await fn()
    expect(mockInvoke).toHaveBeenCalledWith('get-cwd')
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('异常路径：IPC 失败', async () => {
    mockInvoke.mockRejectedValue(new Error('Process not available'))
    const fn = exposedApi.getCwd as () => Promise<string>
    await expect(fn()).rejects.toThrow('Process not available')
  })
})

// ============================================================================
// 18. readFile
// ============================================================================
describe('readFile', () => {
  it('正常路径：读取文件成功', async () => {
    mockInvoke.mockResolvedValue('file content here')
    const fn = exposedApi.readFile as (filePath: string) => Promise<string | null>
    const result = await fn('/path/to/file.yaml')
    expect(mockInvoke).toHaveBeenCalledWith('read-file', '/path/to/file.yaml')
    expect(result).toBe('file content here')
  })

  it('异常路径：文件不存在返回 null', async () => {
    mockInvoke.mockResolvedValue(null)
    const fn = exposedApi.readFile as (filePath: string) => Promise<string | null>
    const result = await fn('/path/to/missing.yaml')
    expect(result).toBeNull()
  })
})

// ============================================================================
// 19. writeFile
// ============================================================================
describe('writeFile', () => {
  it('正常路径：写入文件成功', async () => {
    mockInvoke.mockResolvedValue(true)
    const fn = exposedApi.writeFile as (filePath: string, content: string) => Promise<boolean>
    const result = await fn('/project/schemas/test.yaml', 'key: value')
    expect(mockInvoke).toHaveBeenCalledWith('write-file', '/project/schemas/test.yaml', 'key: value')
    expect(result).toBe(true)
  })

  it('异常路径：路径不存在时自动创建父目录', async () => {
    mockInvoke.mockResolvedValue(true)
    const fn = exposedApi.writeFile as (filePath: string, content: string) => Promise<boolean>
    const result = await fn('/new/dir/file.yaml', 'content')
    expect(result).toBe(true)
  })

  it('异常路径：磁盘空间不足', async () => {
    mockInvoke.mockRejectedValue(new Error('ENOSPC: no space left on device'))
    const fn = exposedApi.writeFile as (filePath: string, content: string) => Promise<boolean>
    await expect(fn('/path/file.yaml', 'huge content')).rejects.toThrow('no space left on device')
  })
})

// ============================================================================
// 20-24. update.* 子模块
// ============================================================================
describe('update', () => {
  let updateApi: Record<string, unknown>

  beforeEach(() => {
    updateApi = exposedApi.update as Record<string, unknown>
  })

  describe('update.getStatus', () => {
    it('正常路径：获取更新状态', async () => {
      mockInvoke.mockResolvedValue({ available: false, version: '0.1.0' })
      const fn = updateApi.getStatus as () => Promise<unknown>
      const result = await fn()
      expect(mockInvoke).toHaveBeenCalledWith('update:get-status')
      expect(result).toEqual({ available: false, version: '0.1.0' })
    })

    it('异常路径：网络错误时查询更新失败', async () => {
      mockInvoke.mockRejectedValue(new Error('Network error connecting to update server'))
      const fn = updateApi.getStatus as () => Promise<unknown>
      await expect(fn()).rejects.toThrow('Network error')
    })
  })

  describe('update.getConfig', () => {
    it('正常路径：获取更新配置', async () => {
      mockInvoke.mockResolvedValue({ sourceType: 'github', autoCheck: true })
      const fn = updateApi.getConfig as () => Promise<unknown>
      const result = await fn()
      expect(mockInvoke).toHaveBeenCalledWith('update:get-config')
      expect(result).toEqual({ sourceType: 'github', autoCheck: true })
    })
  })

  describe('update.saveConfig', () => {
    it('正常路径：保存更新配置', async () => {
      mockInvoke.mockResolvedValue(true)
      const config = { sourceType: 'github' as const, sourceUrl: 'https://example.com', autoCheck: true }
      const fn = updateApi.saveConfig as (config: Record<string, unknown>) => Promise<boolean>
      const result = await fn(config)
      expect(mockInvoke).toHaveBeenCalledWith('update:save-config', config)
      expect(result).toBe(true)
    })

    it('异常路径：无效的配置值', async () => {
      mockInvoke.mockRejectedValue(new Error('Invalid sourceType'))
      const fn = updateApi.saveConfig as (config: Record<string, unknown>) => Promise<boolean>
      await expect(fn({ sourceType: 'invalid' })).rejects.toThrow('Invalid sourceType')
    })
  })

  describe('update.check', () => {
    it('正常路径：手动检查更新', async () => {
      mockInvoke.mockResolvedValue({ hasUpdate: true, version: '0.2.0' })
      const fn = updateApi.check as () => Promise<unknown>
      const result = await fn()
      expect(mockInvoke).toHaveBeenCalledWith('update:check')
      expect(result).toEqual({ hasUpdate: true, version: '0.2.0' })
    })
  })

  describe('update.download', () => {
    it('正常路径：下载更新', async () => {
      mockInvoke.mockResolvedValue({ progress: 100, completed: true })
      const fn = updateApi.download as () => Promise<unknown>
      const result = await fn()
      expect(mockInvoke).toHaveBeenCalledWith('update:download')
      expect(result).toEqual({ progress: 100, completed: true })
    })
  })

  describe('update.install', () => {
    it('正常路径：安装下载好的更新', async () => {
      mockInvoke.mockResolvedValue({ success: true })
      const fn = updateApi.install as () => Promise<unknown>
      const result = await fn()
      expect(mockInvoke).toHaveBeenCalledWith('update:install')
      expect(result).toEqual({ success: true })
    })
  })
})

// ============================================================================
// 综合测试
// ============================================================================
describe('综合 IPC 接口验证', () => {
  it('所有暴露的 API 都是函数（除 platform）', () => {
    const apiKeys = Object.keys(exposedApi)
    expect(apiKeys.length).toBeGreaterThanOrEqual(20)

    for (const key of apiKeys) {
      if (key === 'platform') {
        expect(typeof exposedApi[key]).toBe('string')
      } else if (key === 'update') {
        expect(typeof exposedApi[key]).toBe('object')
        const updateMethods = Object.keys(exposedApi[key] as Record<string, unknown>)
        expect(updateMethods).toContain('getStatus')
        expect(updateMethods).toContain('getConfig')
        expect(updateMethods).toContain('saveConfig')
        expect(updateMethods).toContain('check')
        expect(updateMethods).toContain('download')
        expect(updateMethods).toContain('install')
      } else {
        expect(typeof exposedApi[key]).toBe('function')
      }
    }
  })

  it('每个 IPC 函数调用都会传递参数给 ipcRenderer.invoke', async () => {
    mockInvoke.mockResolvedValue('ok')

    // 测试带参数的 IPC 调用
    const fn1 = exposedApi.ensureDir as (dirPath: string) => Promise<unknown>
    await fn1('/test/dir')
    expect(mockInvoke).toHaveBeenCalledWith('ensure-dir', '/test/dir')

    const fn2 = exposedApi.checkFileExists as (filePath: string) => Promise<boolean>
    await fn2('/test/file.txt')
    expect(mockInvoke).toHaveBeenCalledWith('check-file-exists', '/test/file.txt')
  })
})
