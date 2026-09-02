/**
 * @fileoverview filesystem.ts（write-file / ensure-dir）安全闸门单元测试
 *
 * 覆盖 2026-09-02 风险扫描复现的两条绕过链（修复后必须全部拒绝）：
 * 1. write-file 直接覆写 userData/update-config.json（换源劫持）与
 *    .precis/electron_launch.yaml（授权根信任源毒化 → read-file 越权读任意目录）
 * 2. Windows 尾点/尾空格变体（'update-config.json.' 落盘同名）
 * 以及 ensure-dir 此前缺失的根目录包含校验。
 *
 * 测试策略：mock electron（app.getPath/ipcMain.handle 注册表）+ logger/i18n，
 * 真实 fs 作用于临时目录（userData mock 根）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const mocks = vi.hoisted(() => ({
  handlers: {} as Record<string, (event?: unknown, ...args: unknown[]) => unknown>,
  userData: '',
}))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => mocks.userData) },
  ipcMain: {
    handle: (channel: string, handler: (event?: unknown, ...args: unknown[]) => unknown) => {
      mocks.handlers[channel] = handler
    },
  },
  dialog: { showOpenDialog: vi.fn() },
  shell: { openPath: vi.fn(), openExternal: vi.fn() },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: vi.fn(() => null) },
}))
vi.mock('../src/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../src/i18n', () => ({ t: (key: string) => key }))

import { registerFilesystemIpc } from '../src/ipc/filesystem'

beforeEach(() => {
  mocks.userData = fs.mkdtempSync(path.join(os.tmpdir(), 'precis-fs-test-'))
  mocks.handlers = {}
  registerFilesystemIpc()
})

describe('write-file 受保护文件闸门', () => {
  it('拒绝覆写 userData/update-config.json（换源劫持链封堵）', async () => {
    const target = path.join(mocks.userData, 'update-config.json')
    const ok = (await mocks.handlers['write-file'](
      undefined,
      target,
      '{"sourceType":"custom","sourceUrl":"https://evil.example/feed"}',
    )) as boolean
    expect(ok).toBe(false)
    expect(fs.existsSync(target)).toBe(false)
  })

  it('拒绝覆写 .precis/electron_launch.yaml（信任源毒化链封堵）', async () => {
    const target = path.join(mocks.userData, '.precis', 'electron_launch.yaml')
    const ok = (await mocks.handlers['write-file'](undefined, target, 'configPath: C:\\')) as boolean
    expect(ok).toBe(false)
    expect(fs.existsSync(target)).toBe(false)
  })

  it('信任源毒化后 read-file 仍无法越权读取授权根外文件', async () => {
    const victimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'precis-victim-'))
    const victim = path.join(victimDir, 'secret.txt')
    fs.writeFileSync(victim, 'SECRET-CONTENT')

    expect(await mocks.handlers['read-file'](undefined, victim)).toBeNull()

    const poison = await mocks.handlers['write-file'](
      undefined,
      path.join(mocks.userData, '.precis', 'electron_launch.yaml'),
      `configPath: ${victimDir}\ndataPath: ${victimDir}\n`,
    )
    expect(poison).toBe(false)
    // 毒化未落盘 → 授权根未扩大 → 仍拒绝
    expect(await mocks.handlers['read-file'](undefined, victim)).toBeNull()
  })

  it('拒绝 Windows 尾点/大小写变体（update-config.json. / Update-Config.JSON）', async () => {
    for (const name of ['update-config.json.', 'update-config.json ', 'Update-Config.JSON']) {
      const target = path.join(mocks.userData, name)
      const ok = (await mocks.handlers['write-file'](undefined, target, '{}')) as boolean
      expect(ok, `变体 ${name} 应被拒绝`).toBe(false)
    }
    // Win32 剥尾点后与受保护文件同名的路径上不应存在任何文件
    expect(fs.readdirSync(mocks.userData)).toEqual([])
  })

  it('userData 下的普通文件仍可正常写入（闸门不误伤）', async () => {
    const target = path.join(mocks.userData, 'notes', 'draft.txt')
    const ok = (await mocks.handlers['write-file'](undefined, target, 'hello')) as boolean
    expect(ok).toBe(true)
    expect(fs.readFileSync(target, 'utf-8')).toBe('hello')
  })
})

describe('ensure-dir 根目录校验', () => {
  it('拒绝在授权根之外创建目录', async () => {
    const outside = path.join(os.tmpdir(), `precis-outside-${Date.now()}`, 'deep', 'dir')
    expect(await mocks.handlers['ensure-dir'](undefined, outside)).toBe(false)
    expect(fs.existsSync(outside)).toBe(false)
  })

  it('授权根之内允许创建', async () => {
    const inside = path.join(mocks.userData, 'some', 'dir')
    expect(await mocks.handlers['ensure-dir'](undefined, inside)).toBe(true)
    expect(fs.existsSync(inside)).toBe(true)
  })
})
