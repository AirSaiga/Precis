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
 * @fileoverview config.ts（save-config / load-config）启动配置 IPC 单元测试
 *
 * save-config 是授权根信任源（electron_launch.yaml）的写入端：
 * - 非空路径必须为已存在目录的绝对路径（防渲染层毒化白名单后越权读写）
 * - 双空串是“清理最近项目”的合法载荷，放行
 * load-config 覆盖环境变量注入（E2E）、文件缺失与 YAML 解析路径。
 *
 * 测试策略：mock electron（app.getPath/ipcMain.handle 注册表）+ logger，
 * 真实 fs 作用于临时目录（userData mock 根）。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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
}))
vi.mock('../src/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { registerConfigIpc } from '../src/ipc/config'

const savedEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  mocks.userData = fs.mkdtempSync(path.join(os.tmpdir(), 'precis-config-test-'))
  mocks.handlers = {}
  for (const key of ['PRECIS_RECENT_CONFIG', 'PRECIS_RECENT_DATA']) {
    savedEnv[key] = process.env[key]
    delete process.env[key]
  }
  registerConfigIpc()
})

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  fs.rmSync(mocks.userData, { recursive: true, force: true })
})

describe('save-config 信任源路径校验', () => {
  it('两个路径均为已存在目录的绝对路径时保存成功并落盘 YAML', async () => {
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'precis-cfg-a-'))
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'precis-cfg-b-'))
    const ok = (await mocks.handlers['save-config'](undefined, dirA, dirB)) as boolean
    expect(ok).toBe(true)
    const configFile = path.join(mocks.userData, '.precis', 'electron_launch.yaml')
    expect(fs.existsSync(configFile)).toBe(true)
    // 内容正确性由 load-config round-trip 用例验证（js-yaml 会转义 Windows 反斜杠）
    fs.rmSync(dirA, { recursive: true, force: true })
    fs.rmSync(dirB, { recursive: true, force: true })
  })

  it('拒绝相对路径（防渲染层写入任意相对白名单）', async () => {
    const ok = (await mocks.handlers['save-config'](undefined, 'relative/dir', '')) as boolean
    expect(ok).toBe(false)
    const configFile = path.join(mocks.userData, '.precis', 'electron_launch.yaml')
    expect(fs.existsSync(configFile)).toBe(false)
  })

  it('拒绝不存在的目录路径（绝对但不存在）', async () => {
    const absent = path.join(os.tmpdir(), 'precis-not-exist-dir')
    const ok = (await mocks.handlers['save-config'](undefined, absent, '')) as boolean
    expect(ok).toBe(false)
    const configFile = path.join(mocks.userData, '.precis', 'electron_launch.yaml')
    expect(fs.existsSync(configFile)).toBe(false)
  })

  it('拒绝指向文件的绝对路径（必须是目录）', async () => {
    const filePath = path.join(mocks.userData, 'plain.txt')
    fs.writeFileSync(filePath, 'x')
    const ok = (await mocks.handlers['save-config'](undefined, filePath, '')) as boolean
    expect(ok).toBe(false)
  })

  it('非字符串入参被拒绝（防注入非路径类型）', async () => {
    const ok = (await mocks.handlers['save-config'](undefined, 123 as never, '')) as boolean
    expect(ok).toBe(false)
  })

  it('双空串（清理最近项目载荷）放行并落盘空配置', async () => {
    const ok = (await mocks.handlers['save-config'](undefined, '', '')) as boolean
    expect(ok).toBe(true)
    const configFile = path.join(mocks.userData, '.precis', 'electron_launch.yaml')
    expect(fs.existsSync(configFile)).toBe(true)
  })
})

describe('load-config 读取', () => {
  it('配置文件不存在时返回空值', async () => {
    const result = (await mocks.handlers['load-config']()) as {
      configPath: string
      dataPath: string
    }
    expect(result).toEqual({ configPath: '', dataPath: '' })
  })

  it('save 后 load round-trip 返回保存的路径', async () => {
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'precis-rt-a-'))
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'precis-rt-b-'))
    await mocks.handlers['save-config'](undefined, dirA, dirB)
    const result = (await mocks.handlers['load-config']()) as {
      configPath: string
      dataPath: string
    }
    // js-yaml 在 Windows 上可能把反斜杠转义/规范化，比较时统一为 resolve 后的绝对路径
    expect(path.resolve(result.configPath)).toBe(path.resolve(dirA))
    expect(path.resolve(result.dataPath)).toBe(path.resolve(dirB))
    fs.rmSync(dirA, { recursive: true, force: true })
    fs.rmSync(dirB, { recursive: true, force: true })
  })

  it('环境变量注入优先于磁盘配置（E2E 注入钩子）', async () => {
    process.env.PRECIS_RECENT_CONFIG = 'D:/e2e/project'
    process.env.PRECIS_RECENT_DATA = 'D:/e2e/data'
    const result = (await mocks.handlers['load-config']()) as {
      configPath: string
      dataPath: string
    }
    expect(result).toEqual({ configPath: 'D:/e2e/project', dataPath: 'D:/e2e/data' })
  })

  it('注入 config 但缺 data 时 data 回落为 config 值', async () => {
    process.env.PRECIS_RECENT_CONFIG = 'D:/e2e/only'
    const result = (await mocks.handlers['load-config']()) as { dataPath: string }
    expect(result.dataPath).toBe('D:/e2e/only')
  })

  it('YAML 内容损坏时不抛错，返回空值兜底', async () => {
    fs.mkdirSync(path.join(mocks.userData, '.precis'), { recursive: true })
    fs.writeFileSync(
      path.join(mocks.userData, '.precis', 'electron_launch.yaml'),
      '{{{{not yaml',
      'utf-8'
    )
    const result = (await mocks.handlers['load-config']()) as {
      configPath: string
      dataPath: string
    }
    expect(result).toEqual({ configPath: '', dataPath: '' })
  })
})
