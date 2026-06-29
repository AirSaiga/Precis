/**
 * @fileoverview JSON Schema 约束列解析 E2E 测试
 *
 * 验证约束的列引用解析链路在端到端全量校验中真正生效:
 * - factory.py 的 column_id → column_name 映射(独立约束)
 * - embedded_constraints.py 的 column_name → column_id 解析(内嵌约束)
 *
 * 验证方式:通过 /project/validate/full(全量校验,从项目配置读取约束并解析列引用)
 * 而非 /validate(单约束直接传 column_name,绕过列 ID 解析)。
 * 这样能端到端验证"约束列引用 → 解析 → 校验执行"完整链路。
 *
 * 重要范围说明:
 * JSON「嵌套对象」字段(如 $.profile.name)的「数据加载/列展平」存在独立的既有缺陷
 * (data_engine format 阶段报"缺少列"),非本次约束列解析修复的范围。
 * 因此本测试用「扁平 JSON 字段」+「平面 CSV schema」验证约束列解析链路,
 * 这些场景的数据加载正常,能聚焦验证约束列 ID 解析的正确性。
 * 「嵌套子列的 column_id 解析」本身由后端 pytest 覆盖
 * (test_constraint_factory.py::TestCreateConstraintNestedColumns、
 *  test_embedded_constraints_nested.py)。
 *
 * 测试隔离:使用自建临时项目(非 qa_simple 副本),避免 fixture 污染。
 */

import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { test, expect } from '../fixtures/base'
import { BACKEND_URL, API_PREFIX } from '../config'

function createTempProject(suffix: string): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `precis-json-constraint-${suffix}-`))
  for (const sub of ['schemas', 'constraints', 'data']) {
    fs.mkdirSync(path.join(tmpDir, sub), { recursive: true })
  }
  fs.writeFileSync(
    path.join(tmpDir, 'project.precis.yaml'),
    [
      'version: 2',
      'project:',
      '  id: test-json-constraint',
      '  name: Test JSON Constraint Resolution',
      `  config_path: ${tmpDir}`,
      'schemas: []',
      'constraints: []',
      'regex_nodes: []',
    ].join('\n'),
    'utf-8'
  )
  return tmpDir
}

function cleanupProject(projectDir: string) {
  try {
    fs.rmSync(projectDir, { recursive: true, force: true })
  } catch {
    /* 忽略清理错误 */
  }
}

async function putFullConfig(configPath: string, fullConfig: unknown) {
  const resp = await fetch(`${BACKEND_URL}${API_PREFIX}/project/config/full`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Project-Config-Path': configPath,
    },
    body: JSON.stringify(fullConfig),
  })
  expect(resp.status).toBeLessThan(300)
}

/** 触发全量校验。端点:/api/latest/project/validate/full(project 前缀下)。
 * 注:全量校验的 success 仅表示"任务是否完成",与是否有约束错误无关;
 * 约束错误体现在 errors 列表(stage='constraint')中。 */
async function validateFull(configPath: string) {
  const resp = await fetch(`${BACKEND_URL}${API_PREFIX}/project/validate/full`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Project-Config-Path': configPath,
    },
    body: JSON.stringify({}),
  })
  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`/validate/full 返回 ${resp.status}: ${text.slice(0, 500)}`)
  }
  return (await resp.json()) as {
    success: boolean
    summary: { constraint_error_count: number }
    errors: Array<{
      stage?: string
      error_type?: string
      check_type?: string
      message?: string
      column?: string
      row_index?: number | null
    }>
  }
}

/** 构造标准 settings 块(与现有 E2E 一致) */
function standardSettings() {
  return {
    validation: {
      auto_validate: true,
      strict_mode: false,
      error_handling: 'continue',
      timeout_seconds: 30,
      batch_max_files: 100,
    },
    file_processing: {
      default_encoding: 'utf-8',
      csv_delimiter: ',',
      null_value_strategy: 'null',
      date_format: '%Y-%m-%d',
    },
    script_security: {
      allow_eval: false,
      allow_exec: false,
      sandbox_mode: true,
      timeout_seconds: 10,
    },
  }
}

/** 从校验结果中提取真正的 NotNull 违规(排除 ConstraintConfigError 等配置错误) */
function notNullViolations(errors: Array<{ error_type?: string; check_type?: string }>) {
  return errors.filter(
    (e) => e.check_type === 'NotNullConstraint' && e.error_type === 'NotNullViolation'
  )
}

test.describe('JSON Schema 约束列解析全量校验', () => {
  let tmpDir: string

  test.beforeAll(() => {
    tmpDir = createTempProject('resolve')
  })

  test.afterAll(() => {
    cleanupProject(tmpDir)
  })

  test('JSON schema 扁平字段上的独立约束(column_id)被全量校验执行', async () => {
    const schemaId = 'json_flat_independent'
    const constraintId = 'nn_json_name'
    // 扁平 JSON 记录数组(无嵌套对象):name 字段第 2 条为 null
    const jsonDataPath = path.join(tmpDir, 'data', 'flat.json')
    fs.writeFileSync(
      jsonDataPath,
      JSON.stringify([
        { id: 1, name: 'Alice' },
        { id: 2, name: null },
        { id: 3, name: 'Bob' },
      ]),
      'utf-8'
    )

    const fullConfig = {
      manifest: {
        version: 2,
        project: { id: 'test-json-constraint', name: 'Test JSON Constraint' },
        settings: standardSettings(),
        schemas: [{ id: schemaId, path: `schemas/${schemaId}.schema.yaml` }],
        constraints: [{ id: constraintId, path: `constraints/${constraintId}.constraint.yaml` }],
      },
      schemas: {
        [schemaId]: {
          version: 2,
          id: schemaId,
          name: 'Flat JSON',
          source: {
            mode: 'absolute_file' as const,
            path: jsonDataPath,
            header_row: 0,
            options: { format: 'array' },
          },
          columns: [
            { id: 'col-id', name: 'id', type: 'Int', json_path: '$.id' },
            { id: 'col-name', name: 'name', type: 'Str', json_path: '$.name' },
          ],
          constraints: [],
          script_checks: [],
        },
      },
      constraints: {
        [constraintId]: {
          version: 2,
          id: constraintId,
          type: 'NotNull',
          enabled: true,
          // 独立约束用 column_id 引用列(经 factory.py 解析为 column_name)
          refs: { table_id: schemaId, column_id: 'col-name' },
          params: {},
        },
      },
    }

    await putFullConfig(tmpDir, fullConfig)

    const result = await validateFull(tmpDir)
    // 独立约束引用 column_id,应被 factory.py 解析为 column_name='name' 并执行
    // (修复前 factory.py 列映射不递归,本例为扁平列仍可解析;此测试验证整条链路通畅)
    const violations = notNullViolations(result.errors)
    expect(violations.length).toBe(1)
    expect(violations[0].column).toBe('name')
    expect(violations[0].row_index).toBe(1)
  })

  test('CSV schema 内嵌约束(列名引用)被全量校验执行', async () => {
    const schemaId = 'csv_embedded'
    // 平面 CSV:name 第 2 行为空
    const csvDataPath = path.join(tmpDir, 'data', 'users.csv')
    fs.writeFileSync(csvDataPath, ['id,name', '1,Alice', '2,', '3,Bob'].join('\n'), 'utf-8')

    const fullConfig = {
      manifest: {
        version: 2,
        project: { id: 'test-json-constraint', name: 'Test CSV Embedded' },
        settings: standardSettings(),
        schemas: [{ id: schemaId, path: `schemas/${schemaId}.schema.yaml` }],
        constraints: [],
      },
      schemas: {
        [schemaId]: {
          version: 2,
          id: schemaId,
          name: 'Users',
          source: {
            mode: 'absolute_file' as const,
            path: csvDataPath,
            header_row: 0,
          },
          columns: [
            { id: 'col-id', name: 'id', type: 'Int' },
            { id: 'col-name', name: 'name', type: 'Str' },
          ],
          // 内嵌约束:NotNull 通过列名 'name' 引用(经 embedded_constraints.py 解析为 column_id)
          constraints: [
            {
              id: 'nn_csv_name',
              type: 'NotNull',
              enabled: true,
              column: 'name',
            },
          ],
          script_checks: [],
        },
      },
      constraints: {},
    }

    await putFullConfig(tmpDir, fullConfig)

    const result = await validateFull(tmpDir)
    // 内嵌约束通过列名引用,应被 embedded_constraints.py 解析为 column_id 并执行
    // (此测试验证内嵌约束的列名→ID 解析 + 执行完整链路)
    const violations = notNullViolations(result.errors)
    expect(violations.length).toBe(1)
    expect(violations[0].column).toBe('name')
  })

  test('平面 schema 无约束时全量校验无 NotNull 违规(回归基线)', async () => {
    const schemaId = 'csv_no_constraint'
    const csvDataPath = path.join(tmpDir, 'data', 'clean.csv')
    fs.writeFileSync(csvDataPath, ['id,name', '1,Alice', '2,Bob'].join('\n'), 'utf-8')

    const fullConfig = {
      manifest: {
        version: 2,
        project: { id: 'test-json-constraint', name: 'Test Baseline' },
        settings: standardSettings(),
        schemas: [{ id: schemaId, path: `schemas/${schemaId}.schema.yaml` }],
        constraints: [],
      },
      schemas: {
        [schemaId]: {
          version: 2,
          id: schemaId,
          name: 'Clean',
          source: {
            mode: 'absolute_file' as const,
            path: csvDataPath,
            header_row: 0,
          },
          columns: [
            { id: 'col-id', name: 'id', type: 'Int' },
            { id: 'col-name', name: 'name', type: 'Str' },
          ],
          constraints: [],
          script_checks: [],
        },
      },
      constraints: {},
    }

    await putFullConfig(tmpDir, fullConfig)

    const result = await validateFull(tmpDir)
    // 无约束时不应有任何 NotNull 违规(回归基线,确保校验不会误报)
    expect(notNullViolations(result.errors).length).toBe(0)
  })
})
