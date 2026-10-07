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
 * @fileoverview filesystem.ts（read-file / open-file / scan-directory / 文本读写 / 对话框）单元测试
 *
 * 与 filesystem.test.ts（write-file 闸门）互补，覆盖其余文件 IPC 的行为契约：
 * - read-file：根目录包含校验、存在性/文件类型检查、成功读取
 * - open-file：路径校验 + 数据文件扩展名白名单（拒 .exe 等可执行/脚本）
 * - scan-directory：根目录限定、非目录拒绝、扩展名过滤与递归扫描
 * - save/load-text-file：文件名穿越拒绝、受保护文件拒绝、userData 限定读写
 * - show-open-dialog / reselect-file：窗口句柄有无两条路径
 *
 * 测试策略：mock electron（app.getPath/ipcMain.handle 注册表/dialog/shell）+
 * logger/i18n，真实 fs 作用于临时目录（userData mock 根）。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const mocks = vi.hoisted(() => ({
  handlers: {} as Record<string, (event?: unknown, ...args: unknown[]) => unknown>,
  userData: '',
  fromWebContentsResult: null as unknown,
}))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => mocks.userData) },
  ipcMain: {
    handle: (channel: string, handler: (event?: unknown, ...args: unknown[]) => unknown) => {
      mocks.handlers[channel] = handler
    },
  },
  dialog: {
    showOpenDialog: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] }),
  },
  shell: { openPath: vi.fn().mockResolvedValue(''), openExternal: vi.fn() },
  BrowserWindow: {
    getAllWindows: () => [],
    fromWebContents: vi.fn(() => mocks.fromWebContentsResult),
  },
}))
vi.mock('../src/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../src/i18n', () => ({ t: (key: string) => key }))

import { registerFilesystemIpc } from '../src/ipc/filesystem'

beforeEach(() => {
  mocks.userData = fs.mkdtempSync(path.join(os.tmpdir(), 'precis-fsio-test-'))
  mocks.handlers = {}
  mocks.fromWebContentsResult = null
  registerFilesystemIpc()
})

afterEach(() => {
  fs.rmSync(mocks.userData, { recursive: true, force: true })
})

describe('read-file（授权根内文本读取）', () => {
  it('授权根内存在的文件返回内容', async () => {
    const target = path.join(mocks.userData, 'notes.txt')
    fs.writeFileSync(target, 'hello precis')
    const content = (await mocks.handlers['read-file'](undefined, target)) as string | null
    expect(content).toBe('hello precis')
  })

  it('无效/空路径返回 null', async () => {
    expect(await mocks.handlers['read-file'](undefined, '')).toBeNull()
    expect(await mocks.handlers['read-file'](undefined, 123 as never)).toBeNull()
  })

  it('相对路径返回 null', async () => {
    expect(await mocks.handlers['read-file'](undefined, 'relative/notes.txt')).toBeNull()
  })

  it('授权根之外的路径返回 null（根目录包含校验）', async () => {
    const outside = path.join(os.tmpdir(), `precis-outside-${Date.now()}.txt`)
    expect(await mocks.handlers['read-file'](undefined, outside)).toBeNull()
  })

  it('不存在的文件返回 null', async () => {
    const missing = path.join(mocks.userData, 'missing.txt')
    expect(await mocks.handlers['read-file'](undefined, missing)).toBeNull()
  })

  it('路径指向目录时返回 null', async () => {
    const dir = path.join(mocks.userData, 'subdir')
    fs.mkdirSync(dir)
    expect(await mocks.handlers['read-file'](undefined, dir)).toBeNull()
  })
})

describe('open-file（系统默认程序打开）', () => {
  it('授权根内的白名单数据文件成功打开', async () => {
    const target = path.join(mocks.userData, 'data.csv')
    fs.writeFileSync(target, 'a,b')
    const result = (await mocks.handlers['open-file'](undefined, target)) as {
      success: boolean
    }
    expect(result.success).toBe(true)
  })

  it('空路径/非字符串返回失败', async () => {
    const result = (await mocks.handlers['open-file'](undefined, '')) as { success: boolean }
    expect(result.success).toBe(false)
  })

  it('相对路径返回失败', async () => {
    const result = (await mocks.handlers['open-file'](undefined, 'data.csv')) as {
      success: boolean
    }
    expect(result.success).toBe(false)
  })

  it('授权根之外的路径返回失败', async () => {
    const outside = path.join(os.tmpdir(), `precis-outside-${Date.now()}.csv`)
    const result = (await mocks.handlers['open-file'](undefined, outside)) as { success: boolean }
    expect(result.success).toBe(false)
  })

  it('拒绝可执行/脚本扩展名（.exe 白名单外）', async () => {
    const target = path.join(mocks.userData, 'evil.exe')
    fs.writeFileSync(target, 'MZ')
    const result = (await mocks.handlers['open-file'](undefined, target)) as { success: boolean }
    expect(result.success).toBe(false)
  })

  it('拒绝无扩展名路径', async () => {
    const target = path.join(mocks.userData, 'noext')
    fs.writeFileSync(target, 'x')
    const result = (await mocks.handlers['open-file'](undefined, target)) as { success: boolean }
    expect(result.success).toBe(false)
  })

  it('文件不存在返回失败', async () => {
    const missing = path.join(mocks.userData, 'missing.csv')
    const result = (await mocks.handlers['open-file'](undefined, missing)) as { success: boolean }
    expect(result.success).toBe(false)
  })

  it('shell.openPath 返回错误串时透传为失败', async () => {
    const { shell } = await import('electron')
    vi.mocked(shell.openPath).mockResolvedValueOnce('no default app')
    const target = path.join(mocks.userData, 'data.csv')
    fs.writeFileSync(target, 'a')
    const result = (await mocks.handlers['open-file'](undefined, target)) as {
      success: boolean
      error: string
    }
    expect(result.success).toBe(false)
    expect(result.error).toBe('no default app')
  })
})

describe('scan-directory（递归扫描）', () => {
  it('按扩展名过滤并递归子目录', async () => {
    const root = path.join(mocks.userData, 'scanroot')
    fs.mkdirSync(path.join(root, 'nested', 'deep'), { recursive: true })
    fs.writeFileSync(path.join(root, 'a.csv'), 'x')
    fs.writeFileSync(path.join(root, 'b.txt'), 'x')
    fs.writeFileSync(path.join(root, 'nested', 'c.xlsx'), 'x')
    fs.writeFileSync(path.join(root, 'nested', 'deep', 'd.csv'), 'x')

    const result = (await mocks.handlers['scan-directory'](undefined, {
      dirPath: root,
      allowedExtensions: ['.csv', '.xlsx'],
    })) as string[]

    expect(result.sort()).toEqual(
      [
        path.join(root, 'a.csv'),
        path.join(root, 'nested', 'c.xlsx'),
        path.join(root, 'nested', 'deep', 'd.csv'),
      ].sort()
    )
  })

  it('不传 allowedExtensions 时使用默认值（csv/xlsx/xls）', async () => {
    const root = path.join(mocks.userData, 'scanroot2')
    fs.mkdirSync(root)
    fs.writeFileSync(path.join(root, 'a.csv'), 'x')
    fs.writeFileSync(path.join(root, 'b.txt'), 'x')
    const result = (await mocks.handlers['scan-directory'](undefined, {
      dirPath: root,
    })) as string[]
    expect(result).toEqual([path.join(root, 'a.csv')])
  })

  it('无效路径参数返回空数组', async () => {
    expect(await mocks.handlers['scan-directory'](undefined, { dirPath: '' })).toEqual([])
    expect(
      await mocks.handlers['scan-directory'](undefined, { dirPath: 42 as never })
    ).toEqual([])
  })

  it('授权根之外的目录返回空数组', async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'precis-outside-scan-'))
    try {
      expect(
        await mocks.handlers['scan-directory'](undefined, { dirPath: outside })
      ).toEqual([])
    } finally {
      fs.rmSync(outside, { recursive: true, force: true })
    }
  })

  it('不存在的目录返回空数组', async () => {
    const missing = path.join(mocks.userData, 'missing-dir')
    expect(await mocks.handlers['scan-directory'](undefined, { dirPath: missing })).toEqual([])
  })

  it('路径是文件而非目录时返回空数组', async () => {
    const file = path.join(mocks.userData, 'plain.csv')
    fs.writeFileSync(file, 'x')
    expect(await mocks.handlers['scan-directory'](undefined, { dirPath: file })).toEqual([])
  })

  it('超过最大递归深度时停止并返回已收集结果', async () => {
    // 深度上限 8：构造 10 层目录，最深层文件不应出现
    const root = path.join(mocks.userData, 'deeproot')
    let current = root
    for (let i = 0; i < 10; i++) {
      current = path.join(current, `lvl${i}`)
    }
    fs.mkdirSync(current, { recursive: true })
    const deepFile = path.join(current, 'deep.csv')
    fs.writeFileSync(deepFile, 'x')
    fs.writeFileSync(path.join(root, 'shallow.csv'), 'x')

    const result = (await mocks.handlers['scan-directory'](undefined, {
      dirPath: root,
    })) as string[]
    expect(result).toContain(path.join(root, 'shallow.csv'))
    expect(result).not.toContain(deepFile)
  })
})

describe('save-text-file / load-text-file（userData 文本读写）', () => {
  it('受保护文件名 update-config.json 被拒绝写入', async () => {
    const ok = (await mocks.handlers['save-text-file'](
      undefined,
      'update-config.json',
      '{}'
    )) as boolean
    expect(ok).toBe(false)
    expect(fs.existsSync(path.join(mocks.userData, 'update-config.json'))).toBe(false)
  })

  it('文件名含路径穿越（../ 或分隔符）被拒绝', async () => {
    expect(await mocks.handlers['save-text-file'](undefined, '../escape.txt', 'x')).toBe(false)
    expect(await mocks.handlers['save-text-file'](undefined, 'a/b.txt', 'x')).toBe(false)
    expect(await mocks.handlers['save-text-file'](undefined, 'a\\b.txt', 'x')).toBe(false)
    expect(await mocks.handlers['save-text-file'](undefined, '', 'x')).toBe(false)
  })

  it('反向白名单外的文件名被拒绝（4.20：默认全拒）', async () => {
    const ok = (await mocks.handlers['save-text-file'](undefined, 'random.txt', 'x')) as boolean
    expect(ok).toBe(false)
  })

  it('load-text-file：非法名/缺失返回 null，存在文件返回内容', async () => {
    expect(await mocks.handlers['load-text-file'](undefined, '')).toBeNull()
    expect(await mocks.handlers['load-text-file'](undefined, '../escape.txt')).toBeNull()
    expect(
      await mocks.handlers['load-text-file'](undefined, path.join('a', 'b.txt'))
    ).toBeNull()
    expect(await mocks.handlers['load-text-file'](undefined, 'missing.txt')).toBeNull()

    const target = path.join(mocks.userData, 'existing.txt')
    fs.writeFileSync(target, 'cached content')
    expect(await mocks.handlers['load-text-file'](undefined, 'existing.txt')).toBe('cached content')
  })
})

describe('show-open-dialog / reselect-file（对话框）', () => {
  it('无窗口句柄时直接调用 dialog.showOpenDialog 并透传结果', async () => {
    const { dialog } = await import('electron')
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
      canceled: false,
      filePaths: ['D:/picked.csv'],
    } as never)
    const result = (await mocks.handlers['show-open-dialog']({ sender: {} }, {
      title: 'pick',
    })) as { canceled: boolean; filePaths: string[] }
    expect(dialog.showOpenDialog).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'pick' })
    )
    expect(result.filePaths).toEqual(['D:/picked.csv'])
  })

  it('有窗口句柄时以窗口为父调用 dialog.showOpenDialog', async () => {
    const { dialog } = await import('electron')
    const fakeWin = { id: 1 }
    mocks.fromWebContentsResult = fakeWin
    const fakeEvent = { sender: {} }
    await mocks.handlers['show-open-dialog'](fakeEvent, { title: 't' })
    expect(dialog.showOpenDialog).toHaveBeenCalledWith(
      fakeWin,
      expect.objectContaining({ title: 't' })
    )
  })

  it('reselect-file 无窗口句柄时同样透传 dialog 结果', async () => {
    const { dialog } = await import('electron')
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
      canceled: true,
      filePaths: [],
    } as never)
    const result = (await mocks.handlers['reselect-file']({ sender: {} }, {
      title: 're',
    })) as { canceled: boolean }
    expect(result.canceled).toBe(true)
    expect(dialog.showOpenDialog).toHaveBeenCalledWith(expect.objectContaining({ title: 're' }))
  })
})
