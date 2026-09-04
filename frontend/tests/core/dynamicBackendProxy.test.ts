/**
 * dynamic-backend-proxy 插件 readBackendPort 单元测试
 *
 * 测试覆盖:
 * - 端口文件存在且内容合法 → 返回端口号
 * - 端口文件不存在 → 返回 null
 * - 端口文件内容非法(非数字/空/零/负数) → 返回 null
 *
 * 路径注入:readBackendPort 支持传入端口文件路径参数,测试统一写入 OS 临时目录。
 * 历史教训:本测试曾直接读写真实的 backend/.backend-port(beforeEach/afterEach
 * 无条件 unlink),导致 vitest 与运行中的 dev 环境相互踩踏——代理 502、项目加载
 * 失败、保存静默失败。真实端口文件任何测试都不得触碰。
 */

import { describe, it, expect, afterEach, afterAll } from 'vitest'
import { writeFileSync, unlinkSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'

// 每个文件独立的临时目录,测试结束整目录删除
const TEST_DIR = mkdtempSync(join(tmpdir(), 'precis-proxy-test-'))
const PORT_FILE = resolve(TEST_DIR, '.backend-port')

// 动态导入被测模块,确保每次拿到最新模块状态
async function importFresh() {
  return import('../../dynamic-backend-proxy')
}

describe('readBackendPort', () => {
  afterEach(() => {
    if (existsSync(PORT_FILE)) unlinkSync(PORT_FILE)
  })

  it('端口文件存在且内容合法时返回端口号', async () => {
    const { readBackendPort } = await importFresh()
    writeFileSync(PORT_FILE, '53871', 'utf-8')
    expect(readBackendPort(PORT_FILE)).toBe(53871)
  })

  it('端口文件不存在时返回 null', async () => {
    const { readBackendPort } = await importFresh()
    expect(readBackendPort(PORT_FILE)).toBeNull()
  })

  it('端口文件内容非数字时返回 null', async () => {
    const { readBackendPort } = await importFresh()
    writeFileSync(PORT_FILE, 'not-a-port', 'utf-8')
    expect(readBackendPort(PORT_FILE)).toBeNull()
  })

  it('端口文件内容为空时返回 null', async () => {
    const { readBackendPort } = await importFresh()
    writeFileSync(PORT_FILE, '   ', 'utf-8')
    expect(readBackendPort(PORT_FILE)).toBeNull()
  })

  it('端口文件内容为 0 或负数时返回 null', async () => {
    const { readBackendPort } = await importFresh()
    writeFileSync(PORT_FILE, '0', 'utf-8')
    expect(readBackendPort(PORT_FILE)).toBeNull()
    writeFileSync(PORT_FILE, '-1', 'utf-8')
    expect(readBackendPort(PORT_FILE)).toBeNull()
  })

  it('端口文件有前后空白时能正确 trim 解析', async () => {
    const { readBackendPort } = await importFresh()
    writeFileSync(PORT_FILE, '  18000\n', 'utf-8')
    expect(readBackendPort(PORT_FILE)).toBe(18000)
  })

  it('不传路径参数时回落到真实端口文件路径(仅验证可调用,不断言真实端口)', async () => {
    const { readBackendPort } = await importFresh()
    // 真实文件可能存在(运行中的后端)也可能不存在,两种结果都合法
    const port = readBackendPort()
    expect(port === null || (Number.isInteger(port) && port > 0)).toBe(true)
  })
})

afterAll(() => {
  // 全部用例结束后一次性删除临时目录;Windows 偶发句柄未释放则留待系统清理
  try {
    rmSync(TEST_DIR, { recursive: true, force: true })
  } catch {
    /* 留待系统临时目录清理 */
  }
})
