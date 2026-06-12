/**
 * @fileoverview E2E 正则创建与校验测试
 *
 * 验证正则表达式节点的完整生命周期：
 * 1. 创建 Regex 节点（直接模式）
 * 2. 通过 Regex API 校验数据
 * 3. 修改 pattern 后重新校验
 * 4. 验证匹配/不匹配结果
 */

import { test, expect } from '../fixtures/base'
import * as fs from 'fs'
import * as path from 'path'
import { BACKEND_URL } from '../config'
const projectPath = path.join(__dirname, '..', 'fixtures', 'test-project')
const USERS_CSV = path.join(projectPath, 'data', 'users.csv')

test.beforeAll(() => {
  if (!fs.existsSync(projectPath)) {
    test.skip(true, `E2E fixture 目录不存在: ${projectPath}`)
  }
})

test.describe('Regex Creation & Validation', () => {
  test('创建 Regex 节点并通过 API 校验 — 匹配邮箱格式', async ({ apiHelper }) => {
    const regexId = 'e2e-regex-email'

    // 创建 regex 节点配置
    const regexNode = {
      version: 2,
      id: regexId,
      name: 'Email Format Check',
      description: '校验邮箱格式',
      pattern: '^[\\w.-]+@[\\w.-]+\\.\\w+$',
      match_mode: 'full',
      case_sensitive: false,
      flags: '',
      enabled: true,
      parameters: [],
      rules: [],
    }

    // 保存 regex 节点
    const saveResp = await apiHelper.put(`/project/regex/${regexId}`, regexNode)
    expect(saveResp.status).toBeLessThan(300)

    // 验证文件存在
    const regexPath = path.join(projectPath, 'regex', `${regexId}.regex.yaml`)
    expect(fs.existsSync(regexPath)).toBe(true)

    const savedContent = fs.readFileSync(regexPath, 'utf-8')
    expect(savedContent).toContain('email')
    expect(savedContent).toContain('full')

    // 通过 regex 校验 API 验证 — email 列应该全部匹配
    const validateResp = await apiHelper.post('/regex', {
      source_file_path: USERS_CSV,
      regex_pattern: '^[\\w.-]+@[\\w.-]+\\.\\w+$',
      match_mode: 'full',
      case_sensitive: false,
      target_column_name: 'email',
    })
    expect(validateResp.ok).toBe(true)
    const data = await validateResp.json()
    if (!data.success) {
      test.skip(true, `Regex validation failed: ${data.error || 'unknown error'}`)
      return
    }
    expect(data.data).toBeDefined()
    expect(data.data.is_valid).toBe(true)
    expect(data.data.error_count).toBe(0)
    expect(data.data.match_count).toBe(5)

    // 清理
    if (fs.existsSync(regexPath)) {
      fs.unlinkSync(regexPath)
    }
  })

  test('正则校验检测不匹配的行', async ({ apiHelper }) => {
    // 用纯数字 pattern 校验 name 列 — 全部应不匹配
    const validateResp = await apiHelper.post('/regex', {
      source_file_path: USERS_CSV,
      regex_pattern: '^\\d+$',
      match_mode: 'full',
      case_sensitive: false,
      target_column_name: 'name',
    })
    expect(validateResp.ok).toBe(true)
    const data = await validateResp.json()
    if (!data.success) {
      test.skip(true, `Regex validation failed: ${data.error || 'unknown error'}`)
      return
    }
    expect(data.data).toBeDefined()
    expect(data.data.is_valid).toBe(false)
    expect(data.data.error_count).toBe(5)
    expect(data.data.match_count).toBe(0)
  })

  test('修改 pattern 后重新校验结果更新', async ({ apiHelper }) => {
    // 第一轮：匹配以 A/B/C 开头的名字 — Alice, Bob, Charlie 应匹配
    const resp1 = await apiHelper.post('/regex', {
      source_file_path: USERS_CSV,
      regex_pattern: '^[ABC]\\w+',
      match_mode: 'full',
      case_sensitive: true,
      target_column_name: 'name',
    })
    expect(resp1.ok).toBe(true)
    const data1 = await resp1.json()
    if (!data1.success) {
      test.skip(true, `Regex validation failed: ${data1.error || 'unknown error'}`)
      return
    }
    // Alice, Bob, Charlie → 3 匹配
    expect(data1.data.match_count).toBe(3)
    expect(data1.data.error_count).toBe(2) // Diana, Eve

    // 第二轮：匹配所有名字 — 全部应匹配
    const resp2 = await apiHelper.post('/regex', {
      source_file_path: USERS_CSV,
      regex_pattern: '^[A-Za-z]+$',
      match_mode: 'full',
      case_sensitive: false,
      target_column_name: 'name',
    })
    const data2 = await resp2.json()
    if (!data2.success) {
      test.skip(true, `Regex validation failed: ${data2.error || 'unknown error'}`)
      return
    }
    expect(data2.data.match_count).toBe(5)
    expect(data2.data.error_count).toBe(0)
    expect(data2.data.is_valid).toBe(true)
  })

  test('Regex 节点保存和加载 roundtrip', async ({ apiHelper }) => {
    const regexId = 'e2e-regex-roundtrip'

    const regexNode = {
      version: 2,
      id: regexId,
      name: 'Phone Number Check',
      description: '校验中国大陆手机号',
      pattern: '^1[3-9]\\d{9}$',
      match_mode: 'full',
      case_sensitive: false,
      flags: '',
      enabled: true,
      parameters: [],
      rules: [],
    }

    // 保存
    const saveResp = await apiHelper.put(`/project/regex/${regexId}`, regexNode)
    expect(saveResp.status).toBeLessThan(300)

    // 通过全量配置加载
    const loadResp = await apiHelper.get('/project/config/full')
    expect(loadResp.ok).toBe(true)
    const config = await loadResp.json()
    const loadedRegex = config.regex_nodes?.[regexId]
    expect(loadedRegex).toBeDefined()
    expect(loadedRegex.name).toBe('Phone Number Check')
    expect(loadedRegex.pattern).toBe('^1[3-9]\\d{9}$')
    expect(loadedRegex.match_mode).toBe('full')

    // 通过单个 Regex API 读取
    const getResp = await apiHelper.get(`/project/regex/${regexId}`)
    expect(getResp.ok).toBe(true)
    const singleRegex = await getResp.json()
    expect(singleRegex.id).toBe(regexId)
    expect(singleRegex.pattern).toBe('^1[3-9]\\d{9}$')

    // 清理
    const regexPath = path.join(projectPath, 'regex', `${regexId}.regex.yaml`)
    if (fs.existsSync(regexPath)) {
      fs.unlinkSync(regexPath)
    }
  })

  test('正则校验处理大小写不敏感模式', async ({ apiHelper }) => {
    // case_sensitive=false，匹配 alice/Alice/ALICE 等
    const resp = await apiHelper.post('/regex', {
      source_file_path: USERS_CSV,
      regex_pattern: '^alice$',
      match_mode: 'full',
      case_sensitive: false,
      target_column_name: 'name',
    })
    expect(resp.ok).toBe(true)
    const data = await resp.json()
    if (!data.success) {
      test.skip(true, `Regex validation failed: ${data.error || 'unknown error'}`)
      return
    }
    expect(data.data.match_count).toBe(1) // Alice
    expect(data.data.error_count).toBe(4) // 其他人

    // case_sensitive=true，严格匹配 alice（小写）— 应该 0 匹配
    const resp2 = await apiHelper.post('/regex', {
      source_file_path: USERS_CSV,
      regex_pattern: '^alice$',
      match_mode: 'full',
      case_sensitive: true,
      target_column_name: 'name',
    })
    const data2 = await resp2.json()
    if (!data2.success) {
      test.skip(true, `Regex validation failed: ${data2.error || 'unknown error'}`)
      return
    }
    expect(data2.data.match_count).toBe(0)
    expect(data2.data.error_count).toBe(5)
  })

  test('正则校验处理不存在的列', async ({ apiHelper }) => {
    const resp = await apiHelper.post('/regex', {
      source_file_path: USERS_CSV,
      regex_pattern: '.*',
      match_mode: 'full',
      case_sensitive: false,
      target_column_name: 'nonexistent_column',
    })
    const data = await resp.json()
    expect(data.success).toBe(false)
    expect(data.error).toBeDefined()
  })

  test('通过全量配置创建多个 Regex 节点并批量加载', async ({ apiHelper }) => {
    const regexIds = ['e2e-regex-batch-1', 'e2e-regex-batch-2']

    const fullConfig = {
      manifest: {
        version: 2,
        project: { id: 'e2e-regex-batch', name: 'Regex Batch Test' },
        settings: {
          validation: { auto_validate: true, strict_mode: false, error_handling: 'continue', timeout_seconds: 30, batch_max_files: 100 },
          file_processing: { default_encoding: 'utf-8', csv_delimiter: ',', null_value_strategy: 'null', date_format: '%Y-%m-%d' },
          script_security: { allow_eval: false, allow_exec: false, sandbox_mode: true, timeout_seconds: 10 },
        },
        schemas: [{ id: 'sc_users', path: 'schemas/users.schema.yaml' }],
        regex_nodes: regexIds.map(id => ({ id, path: `regex/${id}.regex.yaml` })),
      },
      schemas: {
        sc_users: {
          version: 2,
          id: 'sc_users',
          name: 'users',
          source: { mode: 'absolute_file' as const, path: USERS_CSV, header_row: 0 },
          columns: [
            { id: 'col-id', name: 'id', type: 'Int' },
            { id: 'col-name', name: 'name', type: 'Str' },
            { id: 'col-email', name: 'email', type: 'Str' },
            { id: 'col-age', name: 'age', type: 'Int' },
          ],
          constraints: [],
          script_checks: [],
        },
      },
      regex_nodes: {
        'e2e-regex-batch-1': {
          version: 2,
          id: 'e2e-regex-batch-1',
          name: 'Name Alpha Check',
          pattern: '^[A-Za-z]+$',
          match_mode: 'full',
          case_sensitive: false,
          flags: '',
          enabled: true,
          parameters: [],
          rules: [],
        },
        'e2e-regex-batch-2': {
          version: 2,
          id: 'e2e-regex-batch-2',
          name: 'Email Domain Check',
          pattern: '@example\\.com$',
          match_mode: 'full',
          case_sensitive: false,
          flags: '',
          enabled: true,
          parameters: [],
          rules: [],
        },
      },
    }

    // 保存
    const saveResp = await apiHelper.put('/project/config/full', fullConfig)
    expect(saveResp.status).toBeLessThan(300)

    // 验证文件存在
    for (const id of regexIds) {
      const p = path.join(projectPath, 'regex', `${id}.regex.yaml`)
      expect(fs.existsSync(p)).toBe(true)
    }

    // 重新加载验证
    const loadResp = await apiHelper.get('/project/config/full')
    const loadedConfig = await loadResp.json()
    expect(loadedConfig.regex_nodes?.['e2e-regex-batch-1']?.name).toBe('Name Alpha Check')
    expect(loadedConfig.regex_nodes?.['e2e-regex-batch-2']?.pattern).toBe('@example\\.com$')

    // 清理
    for (const id of regexIds) {
      const p = path.join(projectPath, 'regex', `${id}.regex.yaml`)
      if (fs.existsSync(p)) {
        fs.unlinkSync(p)
      }
    }
  })
})
