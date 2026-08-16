/**
 * @fileoverview 配置自检与一键修复 E2E（批次二 B1-B3）
 *
 * qa_simple 自带故意损坏的引用（orders_fk_ghost → ghost_table 等），
 * 覆盖"检出 → 修复 → 复检"闭环：
 * - B1: GET full?inspect=true 检出引用完整性错误并按严重度分级
 * - B2: POST /project/inspection/fix-table-ref 修复后复检，该错误消失
 * - B3: 修复不存在的约束 / 无匹配旧值 → 404 / 400，且不破坏原文件
 */

import { test, expect } from '../fixtures/base'
import * as fs from 'fs'
import * as path from 'path'

async function inspect(apiHelper: { get: (e: string) => Promise<Response> }) {
  const resp = await apiHelper.get('/project/config/full?inspect=true')
  expect(resp.status).toBe(200)
  const body = await resp.json()
  expect(body.inspection).toBeDefined()
  return body.inspection as {
    errors: { message: string; severity?: string; code?: string }[]
    warnings: unknown[]
  }
}

test.describe('配置自检与一键修复（B1-B3）', () => {
  test.beforeAll(async ({ apiHelper }) => {
    const healthy = await apiHelper.healthCheck()
    test.skip(!healthy, '后端未启动，跳过')
  })

  test('B1+B2: ghost 表引用检出 → 一键修复 → 复检该错误消失', async ({
    apiHelper,
    isolatedProjectPath,
  }) => {
    // B1: 检出 orders_fk_ghost 的引用完整性错误（blocker 级，带 fix_api）
    const before = await inspect(apiHelper)
    expect(Array.isArray(before.errors)).toBe(true)
    const ghostErrors = (before.errors as unknown as {
      message: string
      severity: string
      fix_api?: { method: string; path: string; body: Record<string, string> }
    }[]).filter((e) => e.message.includes('ghost_table'))
    expect(ghostErrors.length).toBeGreaterThanOrEqual(1)
    expect(ghostErrors[0].message).toContain('orders_fk_ghost')
    expect(ghostErrors[0].severity).toBe('blocker')

    // 修复契约由 issue 的 fix_api 预填（前端真实流程：Drawer 读取 fix_api，
    // 用户选目标表后补 new_table_id 发起请求）
    const fixApi = ghostErrors[0].fix_api
    expect(fixApi).toBeDefined()
    expect(fixApi.method).toBe('POST')
    expect(fixApi.path).toBe('/project/inspection/fix-table-ref')
    expect(fixApi.body.constraint_id).toBe('orders_fk_ghost')
    expect(fixApi.body.old_table_id).toBe('ghost_table')

    const fixResp = await apiHelper.post(fixApi.path, {
      ...fixApi.body,
      new_table_id: 'users',
    })
    expect(fixResp.status).toBeLessThan(300)
    const fixBody = await fixResp.json()
    expect(fixBody.message).toContain('ghost_table')
    expect(fixBody.message).toContain('users')

    // 文件层面：to_table_id 已改写
    const filePath = path.join(isolatedProjectPath, 'constraints', 'orders_fk_ghost.constraint.yaml')
    const saved = fs.readFileSync(filePath, 'utf-8')
    expect(saved).toContain('to_table_id: users')
    expect(saved).not.toContain('ghost_table')
    // 其余字段原样保留
    expect(saved).toContain('to_column_id: ghost_id')

    // 复检：ghost_table 相关错误清零（fixture 其他 blocker 不在断言范围）
    const after = await inspect(apiHelper)
    const ghostAfter = after.errors.filter((e) => e.message.includes('ghost_table'))
    expect(ghostAfter).toHaveLength(0)
  })

  test('B3: 修复不存在的约束返回 404，原配置不被破坏', async ({
    apiHelper,
    isolatedProjectPath,
  }) => {
    const filePath = path.join(isolatedProjectPath, 'constraints', 'orders_fk_ghost.constraint.yaml')
    const original = fs.readFileSync(filePath, 'utf-8')

    // 不存在的约束 ID → 404
    const resp404 = await apiHelper.post('/project/inspection/fix-table-ref', {
      constraint_id: 'no_such_constraint',
      field: 'to',
      old_table_id: 'ghost_table',
      new_table_id: 'users',
    })
    expect(resp404.status).toBe(404)

    // 存在的约束但旧值不匹配 → 400
    const resp400 = await apiHelper.post('/project/inspection/fix-table-ref', {
      constraint_id: 'orders_fk_ghost',
      field: 'to',
      old_table_id: 'not_the_old_value',
      new_table_id: 'users',
    })
    expect(resp400.status).toBe(400)

    // 两次失败请求后文件保持原样
    expect(fs.readFileSync(filePath, 'utf-8')).toBe(original)
  })
})
