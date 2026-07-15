/**
 * dynamic-backend-proxy 插件 readBackendPort 单元测试
 *
 * 测试覆盖:
 * - 端口文件存在且内容合法 → 返回端口号
 * - 端口文件不存在 → 返回 null
 * - 端口文件内容非法(非数字/空) → 返回 null
 *
 * 由于 PORT_FILE 路径在模块级固化(指向 ../backend/.backend-port),
 * 测试通过实际读写该文件验证。前后端共用同一文件路径约定。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, unlinkSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 测试文件位于 frontend/tests/core/,需上溯 3 级到项目根,再进 backend/
// (与被测模块 dynamic-backend-proxy.ts 的 ../backend/.backend-port 指向同一文件)
const TEST_FILE_DIR =
  typeof __dirname !== 'undefined' ? __dirname : dirname(fileURLToPath(import.meta.url))
const PORT_FILE = resolve(TEST_FILE_DIR, '..', '..', '..', 'backend', '.backend-port')

// 动态导入被测模块,确保每次拿到最新模块状态(端口文件可能被其他测试改动)
async function importFresh() {
  return import('../../dynamic-backend-proxy')
}

describe('readBackendPort', () => {
  beforeEach(() => {
    // 确保测试前端口文件不存在
    if (existsSync(PORT_FILE)) unlinkSync(PORT_FILE)
  })

  afterEach(() => {
    // 测试后清理,避免端口文件残留影响 npm run dev
    if (existsSync(PORT_FILE)) unlinkSync(PORT_FILE)
  })

  it('端口文件存在且内容合法时返回端口号', async () => {
    writeFileSync(PORT_FILE, '53871', 'utf-8')
    const { readBackendPort } = await importFresh()
    expect(readBackendPort()).toBe(53871)
  })

  it('端口文件不存在时返回 null', async () => {
    const { readBackendPort } = await importFresh()
    expect(readBackendPort()).toBeNull()
  })

  it('端口文件内容非数字时返回 null', async () => {
    writeFileSync(PORT_FILE, 'not-a-port', 'utf-8')
    const { readBackendPort } = await importFresh()
    expect(readBackendPort()).toBeNull()
  })

  it('端口文件内容为空时返回 null', async () => {
    writeFileSync(PORT_FILE, '   ', 'utf-8')
    const { readBackendPort } = await importFresh()
    expect(readBackendPort()).toBeNull()
  })

  it('端口文件内容为 0 或负数时返回 null', async () => {
    const { readBackendPort } = await importFresh()
    writeFileSync(PORT_FILE, '0', 'utf-8')
    expect(readBackendPort()).toBeNull()
    writeFileSync(PORT_FILE, '-1', 'utf-8')
    expect(readBackendPort()).toBeNull()
  })

  it('端口文件有前后空白时能正确 trim 解析', async () => {
    writeFileSync(PORT_FILE, '  18000\n', 'utf-8')
    const { readBackendPort } = await importFresh()
    expect(readBackendPort()).toBe(18000)
  })
})
