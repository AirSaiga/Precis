/**
 * @fileoverview 约束类型覆盖 E2E（批次一 A1-A8）
 *
 * constraint-crud 仅覆盖 NotNull/Unique/Range 三种；本文件补齐其余七种
 * （AllowedValues/ForeignKey/Conditional/DateLogic/Charset/Scripted/Composite）
 * 的 API 级全链路：全量配置写入 → 约束文件落盘 → GET roundtrip → /validate 命中。
 *
 * 数据基线（qa_simple data/users.csv 五行）：
 *   Alice active  CN 1990-05-15 有 id_card
 *   Bob   inactive CN 1995-03-20 有 id_card
 *   Carol pending  US 1988-11-10 空 id_card
 *   David active  UK 1992-07-08 空 id_card
 *   Eve   pending  CN 2000-01-01 有 id_card
 */

import { test, expect } from '../fixtures/base'
import * as fs from 'fs'
import * as path from 'path'

/** 构建最小可用全量配置（users schema + 一条独立约束） */
function buildConfig(csvPath: string, constraintId: string, constraint: Record<string, unknown>) {
  return {
    manifest: {
      version: 2,
      project: { id: 'e2e-constraint-types', name: 'Constraint Types Coverage' },
      settings: {
        validation: { auto_validate: true, strict_mode: false, error_handling: 'continue', timeout_seconds: 30, batch_max_files: 100 },
        file_processing: { default_encoding: 'utf-8', csv_delimiter: ',', null_value_strategy: 'null', date_format: '%Y-%m-%d' },
        script_security: { allow_eval: false, allow_exec: false, sandbox_mode: true, timeout_seconds: 10 },
      },
      schemas: [{ id: 'users', path: 'schemas/users.schema.yaml' }],
      constraints: [{ id: constraintId, path: `constraints/${constraintId}.constraint.yaml` }],
    },
    schemas: {
      users: {
        version: 2,
        id: 'users',
        name: 'users',
        source: { mode: 'absolute_file' as const, path: csvPath, header_row: 0 },
        columns: [
          { id: 'id', name: 'id', type: 'Int' },
          { id: 'name', name: 'name', type: 'Str' },
          { id: 'email', name: 'email', type: 'Str' },
          { id: 'age', name: 'age', type: 'Int' },
          { id: 'status', name: 'status', type: 'Str' },
          { id: 'birth_date', name: 'birth_date', type: 'Str' },
          { id: 'id_card', name: 'id_card', type: 'Str' },
          { id: 'country', name: 'country', type: 'Str' },
        ],
        constraints: [],
        script_checks: [],
      },
    },
    constraints: {
      [constraintId]: {
        version: 2,
        id: constraintId,
        enabled: true,
        refs: { table_id: 'users', column_id: constraint.columnId as string },
        ...constraint,
      },
    },
  }
}

test.describe('约束类型覆盖（A1-A8）', () => {
  test.beforeAll(async ({ apiHelper }) => {
    const healthy = await apiHelper.healthCheck()
    test.skip(!healthy, '后端未启动，跳过')
  })

  // 每个用例的通用三步：写入 → 落盘+roundtrip → 校验命中
  async function putAndVerify(
    apiHelper: {
      put: (e: string, b: unknown) => Promise<Response>
      get: (e: string) => Promise<Response>
      post: (e: string, b: unknown) => Promise<Response>
      configPath: string
    },
    csvPath: string,
    constraintId: string,
    constraint: Record<string, unknown>,
    fileExpect: string
  ) {
    const config = buildConfig(csvPath, constraintId, constraint)
    const saveResp = await apiHelper.put('/project/config/full', config)
    expect(saveResp.status).toBeLessThan(300)

    const constraintPath = path.join(
      apiHelper.configPath,
      'constraints',
      `${constraintId}.constraint.yaml`
    )
    expect(fs.existsSync(constraintPath)).toBe(true)
    const saved = fs.readFileSync(constraintPath, 'utf-8')
    expect(saved).toContain(fileExpect)

    const loadResp = await apiHelper.get('/project/config/full')
    const loaded = await loadResp.json()
    const roundtripped = loaded.constraints?.[constraintId]
    expect(roundtripped).toBeDefined()
    return roundtripped
  }

  test('A1 AllowedValues：集合外值检出 + roundtrip', async ({ apiHelper, isolatedProjectPath }) => {
    const csvPath = path.join(isolatedProjectPath, 'data', 'users.csv')
    const id = 'e2e-allowed-status'
    const rt = await putAndVerify(
      apiHelper,
      csvPath,
      id,
      { type: 'AllowedValues', columnId: 'status', params: { allowed_values: ['active', 'inactive'] } },
      "allowed_values:"
    )
    expect(rt.params.allowed_values).toEqual(['active', 'inactive'])

    const resp = await apiHelper.post('/validate', {
      source_file_path: csvPath,
      validation_type: 'allowed_values',
      target_column_name: 'status',
      validation_config: { allowed_values: ['active', 'inactive'] },
    })
    const data = await resp.json()
    expect(data.success).toBe(true)
    // Carol/Eve 的 pending 不在集合内
    expect(data.data.is_valid).toBe(false)
    expect(data.data.error_count).toBe(2)
  })

  test('A2 ForeignKey：孤值检出 + 被引值集缺行报错', async ({ apiHelper, isolatedProjectPath }) => {
    const csvPath = path.join(isolatedProjectPath, 'data', 'users.csv')
    const id = 'e2e-fk-id'
    const rt = await putAndVerify(
      apiHelper,
      csvPath,
      id,
      { type: 'ForeignKey', columnId: 'id', params: { target_table: 'ref', target_column: 't_id' } },
      'ForeignKey'
    )
    expect(rt.type).toBe('ForeignKey')

    // 目标值集 [1,2,3]：id=4,5 为孤值
    const resp = await apiHelper.post('/validate', {
      source_file_path: csvPath,
      validation_type: 'foreign_key',
      target_column_name: 'id',
      validation_config: { target_table: 'ref', target_column: 't_id', target_values: [1, 2, 3] },
    })
    const data = await resp.json()
    expect(data.success).toBe(true)
    expect(data.data.is_valid).toBe(false)
    expect(data.data.error_count).toBe(2)
  })

  test('A3 Conditional：条件触发的非空校验', async ({ apiHelper, isolatedProjectPath }) => {
    const csvPath = path.join(isolatedProjectPath, 'data', 'users.csv')
    const id = 'e2e-cond-idcard'
    const rt = await putAndVerify(
      apiHelper,
      csvPath,
      id,
      {
        type: 'Conditional',
        columnId: 'id_card',
        params: { if_column: 'country', if_value: 'CN', then_condition: { operator: 'not_null' } },
      },
      'Conditional'
    )
    expect(rt.params.if_column).toBe('country')

    // country==US 时 id_card 必填：Carol（US，空 id_card）违规 = 1；
    // CN 三行均有 id_card，David（UK）条件不满足不校验
    const resp = await apiHelper.post('/validate', {
      source_file_path: csvPath,
      validation_type: 'conditional',
      target_column_name: 'id_card',
      validation_config: {
        if_column: 'country',
        if_value: 'US',
        then_condition: { operator: 'not_null' },
      },
    })
    const data = await resp.json()
    expect(data.success).toBe(true)
    expect(data.data.is_valid).toBe(false)
    expect(data.data.error_count).toBe(1)
  })

  test('A4 DateLogic：日期比较违规检出', async ({ apiHelper, isolatedProjectPath }) => {
    const csvPath = path.join(isolatedProjectPath, 'data', 'users.csv')
    const id = 'e2e-dl-birth'
    const rt = await putAndVerify(
      apiHelper,
      csvPath,
      id,
      {
        type: 'DateLogic',
        columnId: 'birth_date',
        params: { logic_mode: 'compare', compare_op: 'gt', reference_date: '1990-01-01' },
      },
      'reference_date:'
    )
    expect(rt.params.compare_op).toBe('gt')

    // Carol 1988-11-10 早于参考日期 → 1 行违规
    const resp = await apiHelper.post('/validate', {
      source_file_path: csvPath,
      validation_type: 'date_logic',
      target_column_name: 'birth_date',
      validation_config: { logic_mode: 'compare', compare_op: 'gt', reference_date: '1990-01-01' },
    })
    const data = await resp.json()
    expect(data.success).toBe(true)
    expect(data.data.is_valid).toBe(false)
    expect(data.data.error_count).toBe(1)
  })

  test('A5 Charset：非 ASCII 值检出（临时中文数据）', async ({ apiHelper, isolatedProjectPath }) => {
    // fixture 无中文数据，构造临时 CSV 精确控制
    const csvPath = path.join(isolatedProjectPath, 'data', 'charset_probe.csv')
    fs.writeFileSync(csvPath, 'name\nAlice\n张三\nBob\n李四\n', 'utf-8')

    const id = 'e2e-charset-name'
    const rt = await putAndVerify(
      apiHelper,
      csvPath.replace(/charset_probe\.csv$/, 'users.csv'),
      id,
      { type: 'Charset', columnId: 'name', params: { charset_mode: 'ascii' } },
      'charset_mode: ascii'
    )
    expect(rt.params.charset_mode).toBe('ascii')

    const resp = await apiHelper.post('/validate', {
      source_file_path: csvPath,
      validation_type: 'charset',
      target_column_name: 'name',
      validation_config: { charset_mode: 'ascii' },
    })
    const data = await resp.json()
    expect(data.success).toBe(true)
    // 张三 / 李四 为非 ASCII → 2 行违规
    expect(data.data.is_valid).toBe(false)
    expect(data.data.error_count).toBe(2)
  })

  test('A6 Scripted：未获服务端授权时脚本被跳过（双层安全开关）', async ({
    apiHelper,
    isolatedProjectPath,
  }) => {
    const csvPath = path.join(isolatedProjectPath, 'data', 'users.csv')
    const expression = 're_match(r"^active$", str(value))'
    const id = 'e2e-scripted-status'
    const rt = await putAndVerify(
      apiHelper,
      csvPath,
      id,
      { type: 'Scripted', columnId: 'status', params: { name: 'status_check', expression } },
      'status_check'
    )
    expect(rt.params.expression).toContain('re_match')

    // 安全契约（B-sec6 双层开关）：执行需"请求体 allow_unsafe_eval AND 服务端
    // PRECIS_ALLOW_UNSAFE_EVAL"同时开启。默认服务端未授权——即便请求体开启，
    // 脚本仍被跳过并显式提示（表达式本身的执行由后端单测覆盖）
    for (const allowUnsafe of [false, true]) {
      const resp = await apiHelper.post('/validate', {
        source_file_path: csvPath,
        validation_type: 'scripted',
        target_column_name: 'status',
        allow_unsafe_eval: allowUnsafe,
        validation_config: { script: expression },
      })
      const data = await resp.json()
      expect(data.success).toBe(true)
      expect(JSON.stringify(data.data.error_rows)).toContain('allow_unsafe_eval')
    }
  })

  test('A7 Composite：子约束聚合（not_null + allowed_values）', async ({ apiHelper, isolatedProjectPath }) => {
    const csvPath = path.join(isolatedProjectPath, 'data', 'users.csv')
    const id = 'e2e-composite-status'
    const rt = await putAndVerify(
      apiHelper,
      csvPath,
      id,
      {
        type: 'Composite',
        columnId: 'status',
        params: {
          logic: 'all',
          sub_constraints: [
            { version: 2, id: 'sub_nn', type: 'NotNull', enabled: true, params: {} },
            {
              version: 2,
              id: 'sub_av',
              type: 'AllowedValues',
              enabled: true,
              params: { allowed_values: ['active'] },
            },
          ],
        },
      },
      'sub_constraints:'
    )
    expect(rt.params.logic).toBe('all')
    expect(rt.params.sub_constraints).toHaveLength(2)

    const resp = await apiHelper.post('/validate', {
      source_file_path: csvPath,
      validation_type: 'composite',
      target_column_name: 'status',
      validation_config: {
        logic: 'all',
        sub_constraints: [
          { type: 'NotNull', enabled: true, params: {} },
          { type: 'AllowedValues', enabled: true, params: { allowed_values: ['active'] } },
        ],
      },
    })
    const data = await resp.json()
    expect(data.success).toBe(true)
    // 非 active：inactive(Bob) + pending(Carol/Eve) → 3 行违规
    expect(data.data.is_valid).toBe(false)
    expect(data.data.error_count).toBe(3)
  })

  test('A8 内嵌约束：schema 内联约束 roundtrip + 独立删除后 manifest 引用移除', async ({
    apiHelper,
    isolatedProjectPath,
  }) => {
    const csvPath = path.join(isolatedProjectPath, 'data', 'users.csv')

    // 内嵌：schema.constraints 数组写入 → GET roundtrip 保留
    const config = buildConfig(csvPath, 'e2e-inline-unused', {
      type: 'NotNull',
      columnId: 'name',
      params: {},
    })
    // 在 schema 上内嵌一条（与独立占位并存，避免空 constraints 段序列化差异）
    config.schemas.users.constraints = [
      {
        version: 2,
        id: 'users_email_inline_nn',
        type: 'NotNull',
        enabled: true,
        refs: { table_id: 'users', column_id: 'email' },
        params: {},
      },
    ]
    const saveResp = await apiHelper.put('/project/config/full', config)
    expect(saveResp.status).toBeLessThan(300)

    const loadResp = await apiHelper.get('/project/config/full')
    const loaded = await loadResp.json()
    const schemaConstraints = loaded.schemas?.users?.constraints
    expect(Array.isArray(schemaConstraints)).toBe(true)
    expect(schemaConstraints.some((c: { id: string }) => c.id === 'users_email_inline_nn')).toBe(true)

    // 独立约束删除：从 manifest.constraints 与 constraints 段同时移除 → manifest 不再引用
    delete config.constraints['e2e-inline-unused']
    config.manifest.constraints = []
    const saveResp2 = await apiHelper.put('/project/config/full', config)
    expect(saveResp2.status).toBeLessThan(300)

    const loadResp2 = await apiHelper.get('/project/config/full')
    const loaded2 = await loadResp2.json()
    // GET 会并入 constraints/ 目录中未入清单的残留文件（unlisted 语义），
    // 删除契约以 manifest 不再引用为准
    const refs = (loaded2.manifest.constraints ?? []).map((c: { id: string }) => c.id)
    expect(refs).toHaveLength(0)
    expect(refs).not.toContain('e2e-inline-unused')
  })
})
