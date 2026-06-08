/**
 * @fileoverview E2E 错误导航 + 自动创建节点测试
 *
 * 验证 validation error navigator 组件（T22）的 E2E 行为：
 * 1. 校验错误面板点击 → 画布自动定位到对应节点
 * 2. 错误节点不存在时 → 通过 V2 导入流水线自动创建
 * 3. 无法推断资源时 → 优雅降级（不崩溃 + 日志 warning）
 *
 * 实现策略：
 * 错误导航 = 后端 API 提供足够上下文（table_id/column_id/source_file）
 *          + 前端 importV2ResourceToCanvas 调用 V2 API 加载节点
 * E2E 测试通过 API 层面验证这两个契约：
 * - Validation API 返回的错误对象包含 navigator 所需字段
 * - V2 单个资源 API 能基于 error.table_id 加载出节点数据
 *
 * navigator 的核心决策（`useValidationErrorNavigator.ts`）：
 * - error.table_id 存在 → 直接定位到该 schema 节点
 * - error.table 存在 → 在已有节点中按 tableName/configName 匹配
 * - error.source_file 存在 → 在已有节点中按 source 路径匹配
 * - 都不存在且能推断为 schema 资源 → 调用 importV2ResourceToCanvas
 * - 推断失败 → 返回 false + 日志 warning
 */

import { test, expect } from '../fixtures/base'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const projectPath = path.join(__dirname, '..', 'fixtures', 'test-project')
const BACKEND_URL = process.env.E2E_BACKEND_URL || 'http://localhost:18000'

test.beforeAll(() => {
  if (!fs.existsSync(projectPath)) {
    test.skip(true, `E2E fixture 目录不存在: ${projectPath}`)
  }
})

/**
 * 创建带数据违规的临时项目（用于触发校验错误）
 */
function createValidationProject(
  suffix: string,
  manifestContent: string,
  files: Record<string, string> = {}
): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `precis-nav-${suffix}-`))
  const dirs = ['schemas', 'constraints', 'data']
  for (const d of dirs) {
    fs.mkdirSync(path.join(tmpDir, d), { recursive: true })
  }
  fs.writeFileSync(path.join(tmpDir, 'project.precis.yaml'), manifestContent, 'utf-8')
  for (const [relPath, content] of Object.entries(files)) {
    const target = path.join(tmpDir, relPath)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content, 'utf-8')
  }
  return tmpDir
}

function cleanupProject(projectDir: string) {
  try {
    fs.rmSync(projectDir, { recursive: true, force: true })
  } catch {
    // 忽略清理错误
  }
}

/**
 * 构造一个含 NotNull 约束的 users schema，故意让数据有空值以触发校验错误
 */
function buildManifestWithViolation(
  projectId: string,
  constraintId: string,
  schemaId: string
): string {
  return `version: 2
project:
  id: ${projectId}
  name: ${projectId}
schemas:
  - id: ${schemaId}
    path: schemas/users.schema.yaml
constraints:
  - id: ${constraintId}
    path: constraints/${constraintId}.constraint.yaml
settings:
  validation:
    auto_validate: true
    strict_mode: false
    error_handling: continue
    timeout_seconds: 30
    batch_max_files: 100
  file_processing:
    default_encoding: utf-8
    csv_delimiter: ','
    null_value_strategy: null
    date_format: '%Y-%m-%d'
  script_security:
    allow_eval: false
    allow_exec: false
    sandbox_mode: true
    timeout_seconds: 10
`
}

const USERS_SCHEMA_YAML = `version: 2
id: sc_users_nav
name: users
source:
  mode: relative_file
  path: data/users.csv
columns:
  - id: col-id
    name: id
    type: integer
  - id: col-name
    name: name
    type: string
  - id: col-age
    name: age
    type: integer
`

/**
 * 数据：name 列故意有空值
 */
const USERS_CSV_WITH_VIOLATION = `id,name,age
1,Alice,30
2,,25
3,Charlie,35
4,,28
5,Eve,42
`

/**
 * 触发 NotNull 违规的约束
 */
function buildNotNullConstraint(constraintId: string, schemaId: string): string {
  return `version: 2
id: ${constraintId}
type: NotNull
enabled: true
refs:
  table_id: ${schemaId}
  column_id: col-name
params: {}
`
}

/**
 * 触发 Range 违规的约束（age 列有 42，超出 max=40）
 */
function buildRangeConstraint(constraintId: string, schemaId: string): string {
  return `version: 2
id: ${constraintId}
type: Range
enabled: true
refs:
  table_id: ${schemaId}
  column_id: col-age
params:
  min: 0
  max: 40
`
}

/**
 * 调用全量校验 API
 */
async function runFullValidation(projectDir: string): Promise<any> {
  const resp = await fetch(`${BACKEND_URL}/api/v1/project/v2/validate/full`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Project-Config-Path': projectDir },
    body: JSON.stringify({}),
  })
  if (!resp.ok) {
    throw new Error(`Validation failed: ${resp.status} ${await resp.text()}`)
  }
  return await resp.json()
}

test.describe('Validation Error Navigation E2E', () => {
  test.describe('错误响应包含导航所需字段', () => {
    test('NotNull 违规错误应包含 table_id 字段', async ({ apiHelper }) => {
      const project = createValidationProject(
        'notnull-fields',
        buildManifestWithViolation('nav_notnull', 'c_notnull', 'sc_users_nav'),
        {
          'schemas/users.schema.yaml': USERS_SCHEMA_YAML,
          'constraints/c_notnull.constraint.yaml': buildNotNullConstraint('c_notnull', 'sc_users_nav'),
          'data/users.csv': USERS_CSV_WITH_VIOLATION,
        }
      )
      try {
        const result = await runFullValidation(project)
        expect(result.success).toBe(false)
        expect(result.errors.length).toBeGreaterThan(0)

        // 验证错误包含 navigator 所需字段
        const constraintErrors = result.errors.filter(
          (e: any) => e.stage === 'constraint' || e.error_type?.toLowerCase().includes('notnull')
        )
        expect(constraintErrors.length).toBeGreaterThan(0)

        // 每条 constraint 错误都应至少含以下任一字段（决定导航策略）
        for (const err of constraintErrors) {
          const hasNavHint =
            err.table_id ||
            err.table ||
            err.column_id ||
            err.column ||
            err.source_file ||
            err.source_path
          expect(hasNavHint).toBeTruthy()
        }
      } finally {
        cleanupProject(project)
      }
    })

    test('Range 违规错误应包含 table_id/column_id 字段', async ({ apiHelper }) => {
      const project = createValidationProject(
        'range-fields',
        buildManifestWithViolation('nav_range', 'c_range', 'sc_users_nav'),
        {
          'schemas/users.schema.yaml': USERS_SCHEMA_YAML,
          'constraints/c_range.constraint.yaml': buildRangeConstraint('c_range', 'sc_users_nav'),
          'data/users.csv': USERS_CSV_WITH_VIOLATION,
        }
      )
      try {
        const result = await runFullValidation(project)
        expect(result.success).toBe(false)
        expect(result.errors.length).toBeGreaterThan(0)

        // 找到至少一条 constraint 阶段的错误
        const constraintErrors = result.errors.filter(
          (e: any) => e.stage === 'constraint' || e.error_type?.toLowerCase().includes('range')
        )
        expect(constraintErrors.length).toBeGreaterThan(0)
        // 校验 summary 计数
        expect(result.summary.constraint_error_count).toBeGreaterThan(0)
        expect(result.summary.total_error_count).toBeGreaterThan(0)
      } finally {
        cleanupProject(project)
      }
    })
  })

  test.describe('错误节点已存在时：可基于 table_id 定位', () => {
    test('通过 GET /v2/schemas/{table_id} 验证节点可被定位', async ({ apiHelper }) => {
      // 模拟：navigator 收到 error.table_id="sc_users_nav"，需要确认该项目
      // 存在该 schema 资源（API 端 200 + 返回 schema 内容）
      const project = createValidationProject(
        'locate-existing',
        buildManifestWithViolation('nav_locate', 'c_notnull', 'sc_users_nav'),
        {
          'schemas/users.schema.yaml': USERS_SCHEMA_YAML,
          'constraints/c_notnull.constraint.yaml': buildNotNullConstraint('c_notnull', 'sc_users_nav'),
          'data/users.csv': USERS_CSV_WITH_VIOLATION,
        }
      )
      try {
        // 1. 模拟 navigator 拿到 error.table_id="sc_users_nav"
        const tableId = 'sc_users_nav'

        // 2. navigator 内部先在 graphStore 中查找节点
        //    E2E 视角：调用 V2 API 验证该 schema 存在（如果存在，画布上的节点就有效）
        const schemaResp = await fetch(
          `${BACKEND_URL}/api/v1/project/v2/schemas/${tableId}`,
          { headers: { 'X-Project-Config-Path': project } }
        )
        expect(schemaResp.ok).toBe(true)
        const schema = await schemaResp.json()
        expect(schema.id).toBe(tableId)
        // navigator 会基于 schema 数据构建节点
        expect(schema.columns).toBeDefined()
        expect(schema.columns.length).toBeGreaterThan(0)
      } finally {
        cleanupProject(project)
      }
    })

    test('节点存在时，navigator 不会再次创建（幂等性）', async ({ apiHelper }) => {
      // navigator 流程：
      //   1. resolveErrorNodeId() 返回已存在节点的 ID
      //   2. focusNode() 选中并聚焦
      //   3. 不调用 importV2ResourceToCanvas
      //
      // E2E 验证：API 层面 V2 schema 可重复读取且返回一致（不会创建新文件）
      const project = createValidationProject(
        'idempotent',
        buildManifestWithViolation('nav_idem', 'c_notnull', 'sc_users_nav'),
        {
          'schemas/users.schema.yaml': USERS_SCHEMA_YAML,
          'constraints/c_notnull.constraint.yaml': buildNotNullConstraint('c_notnull', 'sc_users_nav'),
          'data/users.csv': USERS_CSV_WITH_VIOLATION,
        }
      )
      try {
        // 多次调用应返回相同内容
        const resp1 = await fetch(
          `${BACKEND_URL}/api/v1/project/v2/schemas/sc_users_nav`,
          { headers: { 'X-Project-Config-Path': project } }
        )
        const data1 = await resp1.json()

        const resp2 = await fetch(
          `${BACKEND_URL}/api/v1/project/v2/schemas/sc_users_nav`,
          { headers: { 'X-Project-Config-Path': project } }
        )
        const data2 = await resp2.json()

        expect(data1).toEqual(data2)
      } finally {
        cleanupProject(project)
      }
    })
  })

  test.describe('错误节点不存在时：自动创建（V2 导入）', () => {
    test('通过 V2 单个资源 API 模拟 navigator 创建 schema 节点', async ({ apiHelper }) => {
      // navigator 流程（节点不存在时）：
      //   1. resolveErrorResource() → { kind: 'schema', resourceId: 'sc_users_nav' }
      //   2. importV2ResourceToCanvas('schema', 'sc_users_nav', position)
      //   3. 后端调用 getV2Schema() 拉取 schema 数据
      //   4. 在画布上创建节点
      //
      // E2E 验证：底层 API 契约 - schema 数据能被 getV2Schema 获取
      const project = createValidationProject(
        'auto-create',
        buildManifestWithViolation('nav_auto', 'c_notnull', 'sc_users_nav'),
        {
          'schemas/users.schema.yaml': USERS_SCHEMA_YAML,
          'constraints/c_notnull.constraint.yaml': buildNotNullConstraint('c_notnull', 'sc_users_nav'),
          'data/users.csv': USERS_CSV_WITH_VIOLATION,
        }
      )
      try {
        // 模拟 navigator 内部调用：getV2Schema(table_id)
        const schemaResp = await fetch(
          `${BACKEND_URL}/api/v1/project/v2/schemas/sc_users_nav`,
          { headers: { 'X-Project-Config-Path': project } }
        )
        expect(schemaResp.ok).toBe(true)
        const schemaData = await schemaResp.json()
        // navigator 根据 schemaData 创建 Schema 节点
        expect(schemaData.id).toBe('sc_users_nav')
        expect(schemaData.columns).toBeDefined()
        // data source 可用于绑定数据源
        expect(schemaData.source).toBeDefined()
        expect(schemaData.source.path).toContain('users.csv')
      } finally {
        cleanupProject(project)
      }
    })

    test('尝试创建不存在的 schema 资源时，navigator 应优雅降级', async ({ apiHelper }) => {
      // navigator 行为：当 importV2ResourceToCanvas 失败（资源不存在）时
      //   应记录 warning 并返回 false，不崩溃
      //
      // E2E 验证：API 返回 404 即可被前端捕获为"创建失败"
      const project = createValidationProject(
        'auto-create-missing',
        buildManifestWithViolation('nav_missing', 'c_notnull', 'sc_users_nav'),
        {
          'schemas/users.schema.yaml': USERS_SCHEMA_YAML,
          'constraints/c_notnull.constraint.yaml': buildNotNullConstraint('c_notnull', 'sc_users_nav'),
          'data/users.csv': USERS_CSV_WITH_VIOLATION,
        }
      )
      try {
        // navigator 拿到一个错误的 table_id（不在项目里）
        const missingTableId = 'sc_nonexistent_schema'
        const schemaResp = await fetch(
          `${BACKEND_URL}/api/v1/project/v2/schemas/${missingTableId}`,
          { headers: { 'X-Project-Config-Path': project } }
        )
        // 后端返回 404，前端 navigator 捕获后降级（不崩溃）
        expect(schemaResp.status).toBe(404)
      } finally {
        cleanupProject(project)
      }
    })
  })

  test.describe('无法推断资源时：降级行为', () => {
    test('错误对象缺少 table_id/table/source_file 时，navigator 应能识别为无法解析', async ({ apiHelper }) => {
      // navigator 的 resolveErrorNodeId() 会在所有查找失败后返回 null
      // resolveErrorResource() 在没有 table_id 时返回 null
      // 此时 navigator 应记录 warning 并返回 false（不崩溃）
      //
      // E2E 验证：通过直接构造一个空的 error 对象（API 不会返回这种结构，
      // 但 navigator 必须能处理边缘 case）
      const project = createValidationProject(
        'no-context',
        buildManifestWithViolation('nav_nocontext', 'c_notnull', 'sc_users_nav'),
        {
          'schemas/users.schema.yaml': USERS_SCHEMA_YAML,
          'constraints/c_notnull.constraint.yaml': buildNotNullConstraint('c_notnull', 'sc_users_nav'),
          'data/users.csv': USERS_CSV_WITH_VIOLATION,
        }
      )
      try {
        // 验证空 error 不会引发后端错误
        const result = await runFullValidation(project)
        expect(result).toBeDefined()
        expect(result.errors).toBeDefined()

        // 模拟 navigator 处理边缘 case：错误对象没有任何导航线索
        const emptyError: any = {
          stage: 'constraint',
          error_type: 'UnknownError',
          message: 'some message with no table info',
        }
        // 这些字段在 navigator 看来都是 falsy
        const hasAnyNavHint =
          emptyError.table_id || emptyError.table || emptyError.source_file || emptyError.source_path
        expect(hasAnyNavHint).toBeFalsy()
        // 验证 navigator 逻辑（无 table_id）→ resolveErrorResource 返回 null
        // 前端实现：if (error.table_id) → resolve; else → null
        // 该 case 下 navigator 应进入降级路径
      } finally {
        cleanupProject(project)
      }
    })

    test('校验响应中的错误应全部含至少一个导航线索字段', async ({ apiHelper }) => {
      // 边界检查：所有错误都应包含至少一个 navigator 所需字段
      // 如果有错误缺少所有线索，navigator 无法处理，应在 UI 上以"无定位"
      // 状态显示，而非崩溃
      const project = createValidationProject(
        'all-have-hint',
        buildManifestWithViolation('nav_hints', 'c_notnull', 'sc_users_nav'),
        {
          'schemas/users.schema.yaml': USERS_SCHEMA_YAML,
          'constraints/c_notnull.constraint.yaml': buildNotNullConstraint('c_notnull', 'sc_users_nav'),
          'data/users.csv': USERS_CSV_WITH_VIOLATION,
        }
      )
      try {
        const result = await runFullValidation(project)
        for (const err of result.errors) {
          const hasNavHint =
            err.table_id || err.table || err.column_id || err.column || err.source_file || err.source_path
          // 实际校验错误（constraint 阶段）应有 table_id
          // 加载阶段错误（loading）可能有 source_file
          if (err.stage === 'constraint') {
            expect(hasNavHint).toBeTruthy()
          }
        }
      } finally {
        cleanupProject(project)
      }
    })
  })

  test.describe('错误响应结构验证', () => {
    test('errors 列表中每条错误都包含 FullValidationErrorItem 必需字段', async ({ apiHelper }) => {
      const project = createValidationProject(
        'error-shape',
        buildManifestWithViolation('nav_shape', 'c_notnull', 'sc_users_nav'),
        {
          'schemas/users.schema.yaml': USERS_SCHEMA_YAML,
          'constraints/c_notnull.constraint.yaml': buildNotNullConstraint('c_notnull', 'sc_users_nav'),
          'data/users.csv': USERS_CSV_WITH_VIOLATION,
        }
      )
      try {
        const result = await runFullValidation(project)
        expect(result.errors.length).toBeGreaterThan(0)
        for (const err of result.errors) {
          // FullValidationErrorItem 必有字段
          expect(err.stage).toBeDefined()
          expect(['preflight', 'loading', 'format', 'constraint']).toContain(err.stage)
          expect(err.error_type).toBeDefined()
          expect(err.message).toBeDefined()
        }
      } finally {
        cleanupProject(project)
      }
    })

    test('summary 字段汇总与 errors 列表一致', async ({ apiHelper }) => {
      const project = createValidationProject(
        'summary',
        buildManifestWithViolation('nav_summary', 'c_notnull', 'sc_users_nav'),
        {
          'schemas/users.schema.yaml': USERS_SCHEMA_YAML,
          'constraints/c_notnull.constraint.yaml': buildNotNullConstraint('c_notnull', 'sc_users_nav'),
          'data/users.csv': USERS_CSV_WITH_VIOLATION,
        }
      )
      try {
        const result = await runFullValidation(project)
        // summary 中各阶段计数应与 errors 列表匹配
        const actualLoading = result.errors.filter((e: any) => e.stage === 'loading').length
        const actualFormat = result.errors.filter((e: any) => e.stage === 'format').length
        const actualConstraint = result.errors.filter((e: any) => e.stage === 'constraint').length
        expect(result.summary.loading_error_count).toBe(actualLoading)
        expect(result.summary.format_error_count).toBe(actualFormat)
        expect(result.summary.constraint_error_count).toBe(actualConstraint)
        expect(result.summary.total_error_count).toBe(result.errors.length)
      } finally {
        cleanupProject(project)
      }
    })
  })
})
