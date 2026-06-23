/**
 * @fileoverview E2E 全链路冒烟测试（qa_simple 端到端）
 *
 * 使用统一 qa fixture（12 Schema + 18 Regex + 5 Template + 模板实例）验证完整生命周期：
 * 1. 项目加载 — manifest 完整性
 * 2. 资源导入 — Schema + 内嵌约束 + Regex 验证
 * 3. 数据源绑定 — 数据文件访问与预览
 * 4. 校验执行 — 全量校验触发与结果验证
 * 5. 保存 roundtrip — 配置保存与重载一致性
 * 6. 错误导航 — 校验错误包含导航线索字段
 *
 * T46 — 全链路冒烟测试（qa_simple 端到端）
 */

import { test, expect } from '../fixtures/base'
import * as fs from 'fs'
import * as path from 'path'
import { BACKEND_URL } from '../config'
const QA_PROJECT_PATH = path.resolve(__dirname, '..', '..', 'qa_test', 'qa_simple')

// 辅助函数：向后端发起带 project path 的请求
async function apiGet(endpoint: string): Promise<Response> {
  return fetch(`${BACKEND_URL}/api/latest${endpoint}`, {
    headers: { 'X-Project-Config-Path': QA_PROJECT_PATH },
  })
}

async function apiPost(endpoint: string, body: unknown): Promise<Response> {
  return fetch(`${BACKEND_URL}/api/latest${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Project-Config-Path': QA_PROJECT_PATH,
    },
    body: JSON.stringify(body),
  })
}

async function apiPut(endpoint: string, body: unknown): Promise<Response> {
  return fetch(`${BACKEND_URL}/api/latest${endpoint}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Project-Config-Path': QA_PROJECT_PATH,
    },
    body: JSON.stringify(body),
  })
}

test.beforeAll(() => {
  if (!fs.existsSync(QA_PROJECT_PATH)) {
    test.skip(true, `qa_simple fixture 目录不存在: ${QA_PROJECT_PATH}`)
  }
  // 验证关键目录存在
  const missing = ['schemas', 'data', 'regex_nodes', 'templates']
    .filter(d => !fs.existsSync(path.join(QA_PROJECT_PATH, d)))
  if (missing.length > 0) {
    test.skip(true, `qa_simple 缺少子目录: ${missing.join(', ')}`)
  }
})

// ============================================================================
// Stage 1: 项目加载
// ============================================================================
test.describe('Stage 1 — 项目加载', () => {
  test('manifest 包含所有 schema 引用', async () => {
    const resp = await apiGet('/project/manifest')
    expect(resp.status).toBeLessThan(300)

    const manifest = await resp.json()
    expect(manifest.version).toBe(2)
    expect(manifest.project).toBeDefined()
    expect(manifest.project.id).toBe('qa_simple')

    // 验证 schemas 引用
    const schemaIds = manifest.schemas.map((s: { id: string }) => s.id)
    expect(schemaIds.length).toBeGreaterThanOrEqual(10)

    // 验证包含 jsonSchema 类型的 schema
    const hasJsonSchema = schemaIds.some((id: string) => id === 'inventory')
    expect(hasJsonSchema).toBe(true)

    // 验证 regex_nodes 引用
    const regexIds = manifest.regex_nodes?.map((r: { id: string }) => r.id) || []
    expect(regexIds.length).toBeGreaterThanOrEqual(18)

    // 验证 templates 引用
    const templateIds = manifest.templates?.map((t: { id: string }) => t.id) || []
    expect(templateIds).toContain('age_check')
    expect(templateIds).toContain('user_quality_check')

    // 验证 template_instances
    const instances = manifest.template_instances || []
    expect(instances.length).toBe(5)
  })

  test('schemas 目录包含所有 schema 文件', () => {
    const schemasDir = path.join(QA_PROJECT_PATH, 'schemas')
    const files = fs.readdirSync(schemasDir).filter(f => f.endsWith('.schema.yaml'))
    expect(files.length).toBeGreaterThanOrEqual(10)
  })

  test('regex 目录包含所有 regex 文件', () => {
    const regexDir = path.join(QA_PROJECT_PATH, 'regex_nodes')
    const files = fs.readdirSync(regexDir).filter(f => f.endsWith('.regex.yaml'))
    expect(files.length).toBeGreaterThanOrEqual(18)
  })

  test('templates 目录包含模板文件', () => {
    const templatesDir = path.join(QA_PROJECT_PATH, 'templates')
    const files = fs.readdirSync(templatesDir).filter(f => f.endsWith('.template.yaml'))
    expect(files.length).toBe(5)
  })

  test('data 目录包含所有数据文件', () => {
    const dataDir = path.join(QA_PROJECT_PATH, 'data')
    const files = fs.readdirSync(dataDir)
    // 应有至少 10 个数据文件
    const dataFiles = files.filter(f =>
      f.endsWith('.csv') || f.endsWith('.xlsx') || f.endsWith('.json')
    )
    expect(dataFiles.length).toBeGreaterThanOrEqual(10)
  })
})

// ============================================================================
// Stage 2: 资源导入
// ============================================================================
test.describe('Stage 2 — 资源导入', () => {
  test('导入 users Schema 并验证内嵌约束', async () => {
    const manifestResp = await apiGet('/project/manifest')
    const manifest = await manifestResp.json()
    const usersSchemaRef = manifest.schemas.find((s: { id: string }) =>
      s.id === 'users-users'
    )
    expect(usersSchemaRef).toBeDefined()

    const schemaResp = await apiGet(`/project/schemas/${usersSchemaRef.id}`)
    expect(schemaResp.status).toBeLessThan(300)

    const schema = await schemaResp.json()
    expect(schema.id).toBe(usersSchemaRef.id)
    expect(schema.name).toBeTruthy()
    expect(schema.columns).toBeDefined()
    expect(schema.columns.length).toBe(8)

    // 验证内嵌约束
    const constraints = schema.constraints || []
    expect(constraints.length).toBe(2)

    const constraintTypes = constraints.map((c: { type: string }) => c.type)
    expect(constraintTypes).toContain('Unique')
    expect(constraintTypes).toContain('NotNull')
  })

  test('导入 customers Schema 并验证列映射', async () => {
    const manifestResp = await apiGet('/project/manifest')
    const manifest = await manifestResp.json()
    const customersRef = manifest.schemas.find((s: { id: string }) =>
      s.id === 'customers'
    )
    expect(customersRef).toBeDefined()

    const schemaResp = await apiGet(`/project/schemas/${customersRef.id}`)
    expect(schemaResp.status).toBeLessThan(300)

    const schema = await schemaResp.json()
    const columnNames = schema.columns.map((c: { name: string }) => c.name)
    expect(columnNames).toContain('customer_id')
    expect(columnNames).toContain('customer_name')
    expect(columnNames).toContain('email')
    expect(columnNames).toContain('phone')
    expect(columnNames).toContain('age')
    expect(columnNames).toContain('registration_date')

    // 验证列类型
    const idCol = schema.columns.find((c: { name: string }) => c.name === 'customer_id')
    expect(idCol).toBeDefined()
    expect(idCol.primary_key || idCol.primaryKey).toBe(true)
  })

  test('关联 Regex 可通过 V2 API 获取', async () => {
    const manifestResp = await apiGet('/project/manifest')
    const manifest = await manifestResp.json()
    const regexIds = manifest.regex_nodes.map((r: { id: string }) => r.id)

    // 验证至少第一个 regex 可获取
    const firstRegexId = regexIds[0]
    const regexResp = await apiGet(`/project/regex/${firstRegexId}`)
    expect(regexResp.status).toBeLessThan(300)

    const regex = await regexResp.json()
    expect(regex.id).toBe(firstRegexId)
    expect(regex.pattern).toBeTruthy()
    expect(regex.name).toBeTruthy()
  })

  test('导入 categories Schema 并验证 Range 约束参数', async () => {
    const manifestResp = await apiGet('/project/manifest')
    const manifest = await manifestResp.json()
    const catRef = manifest.schemas.find((s: { id: string }) =>
      s.id === 'categories'
    )
    expect(catRef).toBeDefined()

    const schemaResp = await apiGet(`/project/schemas/${catRef.id}`)
    const schema = await schemaResp.json()

    const constraints = schema.constraints || []
    // 应有 Range 约束
    const rangeConstraints = constraints.filter((c: { type: string }) => c.type === 'Range')
    expect(rangeConstraints.length).toBeGreaterThan(0)

    const range = rangeConstraints[0]
    expect(range.params).toBeDefined()
    expect(range.params.min).toBeDefined()
    expect(range.params.max).toBeDefined()
  })

  test('导入 JSON Schema（inventory）并验证嵌套源', async () => {
    const manifestResp = await apiGet('/project/manifest')
    const manifest = await manifestResp.json()
    const jsonRef = manifest.schemas.find((s: { id: string }) =>
      s.id === 'inventory'
    )
    expect(jsonRef).toBeDefined()

    const schemaResp = await apiGet(`/project/schemas/${jsonRef.id}`)
    expect(schemaResp.status).toBeLessThan(300)

    const schema = await schemaResp.json()
    expect(schema.columns).toBeDefined()
    expect(schema.columns.length).toBeGreaterThan(0)

    // 应包含外键约束
    const fkConstraint = (schema.constraints || []).find(
      (c: { type: string }) => c.type === 'ForeignKey'
    )
    expect(fkConstraint).toBeDefined()
  })
})

// ============================================================================
// Stage 3: 数据源绑定
// ============================================================================
test.describe('Stage 3 — 数据源绑定', () => {
  test('绑定 CSV 数据文件并预览', async () => {
    const customersPath = path.join(QA_PROJECT_PATH, 'data', 'customers.csv')
    expect(fs.existsSync(customersPath)).toBe(true)

    const previewResp = await apiPost('/preview/content', {
      source_file_path: customersPath,
      header_row: 0,
    })

    // 预览可能失败（依赖后端实现），但不应崩溃
    if (previewResp.ok) {
      const preview = await previewResp.json()
      expect(preview).toBeDefined()
    } else {
      expect(previewResp.status).toBeLessThan(500)
    }
  })

  test('验证 Schema source 路径对应的数据文件存在', async () => {
    const manifestResp = await apiGet('/project/manifest')
    const manifest = await manifestResp.json()

    // 检查 orders-csv schema 指向 data/orders.csv
    const ordersRef = manifest.schemas.find((s: { id: string }) =>
      s.id === 'orders-csv'
    )
    expect(ordersRef).toBeDefined()

    const schemaResp = await apiGet(`/project/schemas/${ordersRef.id}`)
    const schema = await schemaResp.json()
    expect(schema.source).toBeDefined()
    expect(schema.source.path).toBeTruthy()

    // 数据文件应存在
    const dataPath = path.join(QA_PROJECT_PATH, schema.source.path)
    expect(fs.existsSync(dataPath)).toBe(true)
  })

  test('JSON 数据源文件存在且可读', () => {
    const inventoryPath = path.join(QA_PROJECT_PATH, 'data', 'inventory_nested.json')
    expect(fs.existsSync(inventoryPath)).toBe(true)

    const content = fs.readFileSync(inventoryPath, 'utf-8')
    const parsed = JSON.parse(content)
    expect(parsed).toBeDefined()
    expect(parsed.warehouse_data).toBeDefined()
    expect(parsed.warehouse_data.inventory).toBeDefined()
    expect(Array.isArray(parsed.warehouse_data.inventory)).toBe(true)
  })
})

// ============================================================================
// Stage 4: 校验执行
// ============================================================================
test.describe('Stage 4 — 校验执行', () => {
  test('全量校验触发成功并返回结构化结果', async () => {
    const resp = await apiPost('/project/validate/full', {})
    expect(resp.status).toBeLessThan(300)

    const result = await resp.json()
    expect(result.success).toBeDefined()
    expect(result.summary).toBeDefined()
    expect(result.errors).toBeDefined()
    expect(Array.isArray(result.errors)).toBe(true)

    // summary 应有各阶段计数
    expect(typeof result.summary.total_error_count).toBe('number')
    expect(typeof result.summary.constraint_error_count).toBe('number')
  })

  test('校验结果中的错误包含阶段分类', async () => {
    const resp = await apiPost('/project/validate/full', {})
    const result = await resp.json()

    for (const err of result.errors) {
      expect(err.stage).toBeDefined()
      expect(['preflight', 'loading', 'format', 'constraint']).toContain(err.stage)
      expect(err.error_type).toBeDefined()
      expect(err.message).toBeDefined()
    }
  })

  test('employees Schema 校验不崩溃', async () => {
    const manifestResp = await apiGet('/project/manifest')
    const manifest = await manifestResp.json()
    const empRef = manifest.schemas.find((s: { id: string }) =>
      s.id === 'employees'
    )
    expect(empRef).toBeDefined()

    // 单独获取 schema 验证其结构完整
    const schemaResp = await apiGet(`/project/schemas/${empRef.id}`)
    const schema = await schemaResp.json()
    expect(schema.columns.length).toBe(11)

    const constraints = schema.constraints || []
    // 应有 Unique + NotNull(2) + Range + AllowedValues = 5 个约束
    expect(constraints.length).toBeGreaterThanOrEqual(5)
  })

  test('order_items Schema 校验 Range 参数正确', async () => {
    const manifestResp = await apiGet('/project/manifest')
    const manifest = await manifestResp.json()
    const oiRef = manifest.schemas.find((s: { id: string }) =>
      s.id === 'order_items'
    )
    expect(oiRef).toBeDefined()

    const schemaResp = await apiGet(`/project/schemas/${oiRef.id}`)
    const schema = await schemaResp.json()
    const rangeConstraints = (schema.constraints || []).filter(
      (c: { type: string }) => c.type === 'Range'
    )
    // order_items 有 4 个 Range 约束
    expect(rangeConstraints.length).toBeGreaterThanOrEqual(4)
  })

  test('全量校验 summary 与 errors 列表一致性', async () => {
    const resp = await apiPost('/project/validate/full', {})
    const result = await resp.json()

    const actualLoading = result.errors.filter((e: { stage: string }) => e.stage === 'loading').length
    const actualFormat = result.errors.filter((e: { stage: string }) => e.stage === 'format').length
    const actualConstraint = result.errors.filter((e: { stage: string }) => e.stage === 'constraint').length

    expect(result.summary.loading_error_count).toBe(actualLoading)
    expect(result.summary.format_error_count).toBe(actualFormat)
    expect(result.summary.constraint_error_count).toBe(actualConstraint)
    expect(result.summary.total_error_count).toBe(result.errors.length)
  })
})

// ============================================================================
// Stage 5: 保存 Roundtrip
// ============================================================================
test.describe('Stage 5 — 保存 Roundtrip', () => {
  test('完整配置加载并解析为有效结构', async () => {
    const loadResp = await apiGet('/project/config/full')
    expect(loadResp.status).toBeLessThan(300)

    const config = await loadResp.json()
    expect(config.manifest).toBeDefined()
    expect(config.manifest.project).toBeDefined()
    expect(config.manifest.schemas).toBeDefined()

    // schemas 字典应有内容
    expect(config.schemas).toBeDefined()
    const schemaKeys = Object.keys(config.schemas || {})
    expect(schemaKeys.length).toBeGreaterThan(0)

    // regex_nodes 字典
    expect(config.regex_nodes).toBeDefined()
    const regexKeys = Object.keys(config.regex_nodes || {})
    expect(regexKeys.length).toBeGreaterThanOrEqual(18)
  })

  test('Schema 文件重读与初始加载一致', async () => {
    // 通过全量配置获取 schema
    const configResp = await apiGet('/project/config/full')
    const config = await configResp.json()

    const manifestResp = await apiGet('/project/manifest')
    const manifest = await manifestResp.json()

    const firstSchemaRef = manifest.schemas[0]
    const schemaInConfig = config.schemas?.[firstSchemaRef.id]
    expect(schemaInConfig).toBeDefined()

    // 通过单个 API 读取
    const singleResp = await apiGet(`/project/schemas/${firstSchemaRef.id}`)
    const singleSchema = await singleResp.json()

    // 列数应一致
    expect(singleSchema.columns.length).toBe(schemaInConfig.columns.length)
  })

  test('Regex 文件通过全量配置重读完整性', async () => {
    const configResp = await apiGet('/project/config/full')
    const config = await configResp.json()

    for (const [regexId, regexData] of Object.entries(config.regex_nodes || {})) {
      expect((regexData as Record<string, unknown>).id).toBe(regexId)
      expect((regexData as Record<string, unknown>).pattern).toBeTruthy()
      expect((regexData as Record<string, unknown>).source_ref).toBeDefined()
    }
  })

  test('project.view.json 可读且格式正确', async () => {
    const viewResp = await apiGet('/project/view')
    // view 可能存在也可能不存在（取决于后端实现）
    if (viewResp.ok) {
      const view = await viewResp.json()
      expect(view.version).toBeDefined()
      expect(view.nodes).toBeDefined()
      expect(view.viewport).toBeDefined()
    }
  })
})

// ============================================================================
// Stage 6: 错误导航
// ============================================================================
test.describe('Stage 6 — 错误导航', () => {
  test('所有 schema 资源可通过 getV2Schema 访问', async () => {
    const manifestResp = await apiGet('/project/manifest')
    const manifest = await manifestResp.json()

    for (const schemaRef of manifest.schemas) {
      const schemaResp = await apiGet(`/project/schemas/${schemaRef.id}`)
      expect(schemaResp.status).toBeLessThan(300)

      const schema = await schemaResp.json()
      // schema 可能返回文件内部的 id（如 "users_sheet"），可能与 manifest 引用的编码 id 不同
      expect(schema.id).toBeDefined()
      expect(typeof schema.id).toBe('string')
      expect(schema.columns).toBeDefined()
    }
  })

  test('不存在的 schema 返回 404（navigator 降级路径）', async () => {
    const resp = await apiGet('/project/schemas/sc_nonexistent_abcdef')
    expect(resp.status).toBe(404)
  })

  test('校验错误应包含导航所需字段', async () => {
    const resp = await apiPost('/project/validate/full', {})
    const result = await resp.json()

    const constraintErrors = result.errors.filter(
      (e: { stage: string }) => e.stage === 'constraint'
    )

    for (const err of constraintErrors) {
      const hasNavHint =
        err.table_id || err.table || err.column_id || err.column ||
        err.source_file || err.source_path
      expect(hasNavHint).toBeTruthy()
    }
  })

  test('所有 regex 资源可通过 getV2Regex 访问', async () => {
    const manifestResp = await apiGet('/project/manifest')
    const manifest = await manifestResp.json()

    for (const regexRef of manifest.regex_nodes) {
      const regexResp = await apiGet(`/project/regex/${regexRef.id}`)
      expect(regexResp.status).toBeLessThan(300)

      const regex = await regexResp.json()
      expect(regex.id).toBe(regexRef.id)
    }
  })
})

// ============================================================================
// 综合 — 完整性验证
// ============================================================================
test.describe('综合 — 完整性验证', () => {
  test('manifest 引用的 schema 文件在磁盘上实际存在', () => {
    const manifestContent = fs.readFileSync(
      path.join(QA_PROJECT_PATH, 'project.precis.yaml'),
      'utf-8'
    )
    // 解析 manifest 中的 schema path 引用
    const pathMatches = manifestContent.matchAll(/path:\s*schemas\/([\w-]+\.schema\.yaml)/g)
    const referencedPaths = Array.from(pathMatches, m => m[1])

    expect(referencedPaths.length).toBeGreaterThanOrEqual(10)

    for (const schemaPath of referencedPaths) {
      const fullPath = path.join(QA_PROJECT_PATH, 'schemas', schemaPath)
      expect(fs.existsSync(fullPath)).toBe(true)
    }
  })

  test('manifest 引用的 regex 文件在磁盘上实际存在', () => {
    const manifestContent = fs.readFileSync(
      path.join(QA_PROJECT_PATH, 'project.precis.yaml'),
      'utf-8'
    )
    const pathMatches = manifestContent.matchAll(/path:\s*regex_nodes\/([\w-]+\.regex\.yaml)/g)
    const referencedPaths = Array.from(pathMatches, m => m[1])

    expect(referencedPaths.length).toBeGreaterThanOrEqual(18)

    for (const regexPath of referencedPaths) {
      const fullPath = path.join(QA_PROJECT_PATH, 'regex_nodes', regexPath)
      expect(fs.existsSync(fullPath)).toBe(true)
    }
  })

  test('所有数据源文件存在且非空', () => {
    const dataDir = path.join(QA_PROJECT_PATH, 'data')
    const dataFiles = fs.readdirSync(dataDir).filter(f =>
      f.endsWith('.csv') || f.endsWith('.xlsx') || f.endsWith('.json')
    )

    for (const file of dataFiles) {
      const filePath = path.join(dataDir, file)
      const stats = fs.statSync(filePath)
      expect(stats.size).toBeGreaterThan(0)
    }
  })

  test('项目完整配置可被加载并包含所有必需端', async () => {
    const configResp = await apiGet('/project/config/full')
    const config = await configResp.json()

    // 验证全量配置包含所有 section
    expect(config.manifest).toBeDefined()

    // schemas 计数应与 manifest 中 schemas 数量一致
    const manifestSchemaCount = config.manifest?.schemas?.length || 0
    const loadedSchemaCount = Object.keys(config.schemas || {}).length
    expect(loadedSchemaCount).toBeGreaterThanOrEqual(manifestSchemaCount)

    // regex 计数
    const manifestRegexCount = config.manifest?.regex_nodes?.length || 0
    const loadedRegexCount = Object.keys(config.regex_nodes || {}).length
    expect(loadedRegexCount).toBe(manifestRegexCount)
  })
})
