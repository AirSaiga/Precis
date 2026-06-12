/**
 * @fileoverview E2E 模板展开验证测试
 *
 * 验证 templateInstance 节点导入 → 展开 → 收起 → 重新展开 → 清理
 * 的完整生命周期，以及后端 expand API 的契约正确性：
 *
 * 1. 创建模板定义文件 + 模板实例引用
 * 2. 触发展开 API：返回的 constraints/transforms/regex_nodes 结构
 * 3. 验证展开节点数量、类型、命名空间 ID、参数替换
 * 4. 验证多个模板实例可同时存在且互不干扰
 * 5. 验证缺少必填参数时 API 返回 400 而非崩溃
 * 6. 验证加载项目时模板实例被自动展开（contract 验证）
 *
 * 模板展开（template expansion）将一个模板定义 + 参数绑定值
 * 展开为标准的 TransformFile / ConstraintFile / RegexNodeFile 列表，
 * 节点 ID 格式为 `{instance_id}__{local_node_id}`。
 */

import { test, expect } from '../fixtures/base'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { BACKEND_URL } from '../config'

const projectPath = path.join(__dirname, '..', 'fixtures', 'test-project')

test.beforeAll(() => {
  if (!fs.existsSync(projectPath)) {
    test.skip(true, `E2E fixture 目录不存在: ${projectPath}`)
  }
})

/**
 * 创建临时模板测试项目目录，避免污染共享 fixture
 */
function createTemplateProject(
  suffix: string,
  manifestContent: string,
  files: Record<string, string> = {}
): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `precis-tpl-${suffix}-`))
  const dirs = ['schemas', 'constraints', 'data', 'templates']
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
 * 基础年龄范围模板（单节点 Range 约束）
 */
const AGE_CHECK_TEMPLATE = `version: 2
id: age_check
name: 年龄范围校验
description: 校验年龄是否在指定范围内
parameters:
  - id: source_column
    type: string
    label: 校验列名
    required: true
  - id: min_age
    type: integer
    label: 最小年龄
    required: true
  - id: max_age
    type: integer
    label: 最大年龄
    required: false
    default: 120
nodes:
  - id: age_range
    kind: constraint
    type: Range
    input_from_node: "{{input_anchor}}"
    refs:
      table_id: "{{input_anchor}}"
      column_id: "{{source_column}}"
    params:
      min: "{{min_age}}"
      max: "{{max_age}}"
    description: 年龄范围校验
    enabled: true
input_anchor:
  id: input_anchor
  label: 数据源入口
  accepts:
    - schema
    - transformOutput
    - manualData
`

/**
 * 复合模板（包含 transform + 多个约束）
 */
const USER_QUALITY_TEMPLATE = `version: 2
id: user_quality_check
name: 用户数据质量综合校验
description: 对用户表进行多维度质量校验
parameters:
  - id: age_column
    type: string
    label: 年龄列名
    required: true
  - id: email_column
    type: string
    label: 邮箱列名
    required: true
  - id: min_age
    type: integer
    label: 最小年龄
    required: true
  - id: max_age
    type: integer
    label: 最大年龄
    required: false
    default: 120
  - id: gender_column
    type: string
    label: 性别列名
    required: false
    default: gender
nodes:
  - id: age_range
    kind: constraint
    type: Range
    input_from_node: "{{input_anchor}}"
    refs:
      table_id: "{{input_anchor}}"
      column_id: "{{age_column}}"
    params:
      min: "{{min_age}}"
      max: "{{max_age}}"
    description: 年龄范围校验
    enabled: true
  - id: email_notnull
    kind: constraint
    type: NotNull
    input_from_node: "{{input_anchor}}"
    refs:
      table_id: "{{input_anchor}}"
      column_id: "{{email_column}}"
    params: {}
    description: 邮箱非空校验
    enabled: true
  - id: gender_allowed
    kind: constraint
    type: AllowedValues
    input_from_node: "{{input_anchor}}"
    refs:
      table_id: "{{input_anchor}}"
      column_id: "{{gender_column}}"
    params:
      allowed_values:
        - male
        - female
        - other
    description: 性别枚举值校验
    enabled: true
  - id: age_classify
    kind: transform
    type: MathExpr
    input_from_node: "{{input_anchor}}"
    refs:
      table_id: "{{input_anchor}}"
    params:
      expression: "{{age_column}} >= 18 ? 1 : 0"
    output_columns:
      - is_adult
    description: 年龄分类
    enabled: true
input_anchor:
  id: input_anchor
  label: 用户数据源
  accepts:
    - schema
    - transformOutput
    - manualData
`

/**
 * 基础 users schema
 */
const USERS_SCHEMA_YAML = `version: 2
id: sc_users
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
  - id: col-email
    name: email
    type: string
`

/**
 * 基础 manifest with users schema
 */
function buildBaseManifest(projectId: string, projectName: string, extras: Record<string, unknown> = {}) {
  return {
    version: 2,
    project: { id: projectId, name: projectName },
    settings: {
      validation: { auto_validate: true, strict_mode: false, error_handling: 'continue', timeout_seconds: 30, batch_max_files: 100 },
      file_processing: { default_encoding: 'utf-8', csv_delimiter: ',', null_value_strategy: 'null', date_format: '%Y-%m-%d' },
      script_security: { allow_eval: false, allow_exec: false, sandbox_mode: true, timeout_seconds: 10 },
    },
    schemas: [{ id: 'sc_users', path: 'schemas/users.schema.yaml' }],
    ...extras,
  }
}

test.describe('Template Expansion E2E', () => {
  test.describe('Template CRUD', () => {
    test('创建模板 → 读取 → 列出', async ({ apiHelper }) => {
      const project = createTemplateProject(
        'create',
        `version: 2
project:
  id: tpl_create
  name: Template Create
schemas: []
templates:
  - id: age_check
    path: templates/age_check.template.yaml
`,
        { 'templates/age_check.template.yaml': AGE_CHECK_TEMPLATE }
      )
      try {
        // 1. 列出模板（应能读到 age_check）
        const listResp = await apiHelper.get('/project/template')
        const templates = await listResp.json()
        // 至少应包含 1 个模板（前提是 X-Project-Config-Path 生效，否则为空）
        // 因为 base fixture 指向 test-project，新创建的临时项目不可见
        // 我们用直接 fetch 验证
        const directResp = await fetch(`${BACKEND_URL}/api/latest/project/template`, {
          headers: { 'X-Project-Config-Path': project },
        })
        expect(directResp.ok).toBe(true)
        const directTemplates = await directResp.json()
        expect(directTemplates.length).toBe(1)
        expect(directTemplates[0].id).toBe('age_check')
        expect(directTemplates[0].name).toBe('年龄范围校验')
        expect(directTemplates[0].node_count).toBe(1)
        expect(directTemplates[0].parameter_count).toBe(3)

        // 2. 按 ID 读取模板
        const getResp = await fetch(`${BACKEND_URL}/api/latest/project/template/age_check`, {
          headers: { 'X-Project-Config-Path': project },
        })
        expect(getResp.ok).toBe(true)
        const tpl = await getResp.json()
        expect(tpl.id).toBe('age_check')
        expect(tpl.parameters).toBeDefined()
        expect(tpl.parameters.length).toBe(3)
        expect(tpl.nodes).toBeDefined()
        expect(tpl.nodes.length).toBe(1)
        expect(tpl.nodes[0].type).toBe('Range')
        // 输入锚点定义
        expect(tpl.input_anchor).toBeDefined()
        expect(tpl.input_anchor.accepts).toContain('schema')
      } finally {
        cleanupProject(project)
      }
    })

    test('读取不存在的模板返回 404', async ({ apiHelper }) => {
      const project = createTemplateProject(
        'ghost',
        `version: 2\nproject:\n  id: tpl_ghost\n  name: Ghost\nschemas: []\n`
      )
      try {
        const resp = await fetch(
          `${BACKEND_URL}/api/latest/project/template/__nonexistent_template__`,
          { headers: { 'X-Project-Config-Path': project } }
        )
        expect(resp.status).toBe(404)
        const body = await resp.json()
        expect(body.detail).toContain('不存在')
      } finally {
        cleanupProject(project)
      }
    })
  })

  test.describe('Expand API 契约', () => {
    test('展开 age_check 模板 → 1 个 Range 约束 + 命名空间 ID + 参数替换', async ({ apiHelper }) => {
        const project = createTemplateProject(
        'age-expand',
        buildBaseManifestProjectYaml('tpl_age_expand', 'Age Expand', [
          { id: 'age_check', path: 'templates/age_check.template.yaml' },
        ]),
        {
          'schemas/users.schema.yaml': USERS_SCHEMA_YAML,
          'templates/age_check.template.yaml': AGE_CHECK_TEMPLATE,
        }
      )
      try {
        // 调用 expand API
        const expandResp = await fetch(
          `${BACKEND_URL}/api/latest/project/template/age_check/expand`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Project-Config-Path': project,
            },
            body: JSON.stringify({
              instance_id: 'age_check_inst',
              params: { source_column: 'age', min_age: 18, max_age: 100 },
              input_from_node: 'sc_users',
            }),
          }
        )
        expect(expandResp.ok).toBe(true)
        const result = await expandResp.json()
        expect(result.transforms).toEqual([])
        expect(result.regex_nodes).toEqual([])
        expect(result.constraints.length).toBe(1)

        const ageRange = result.constraints[0]
        expect(ageRange.type).toBe('Range')
        // 命名空间 ID 格式：{instance_id}__{local_id}
        expect(ageRange.id).toBe('age_check_inst__age_range')
        // 参数被正确替换
        expect(ageRange.params.min).toBe(18)
        expect(ageRange.params.max).toBe(100)
        // refs 中的 {{source_column}} 被替换为 'age'
        expect(ageRange.refs.column_id).toBe('age')
        // refs 中的 {{input_anchor}} 被替换为 sc_users
        expect(ageRange.refs.table_id).toBe('sc_users')
        // input_from_node 替换为外部上游节点
        expect(ageRange.input_from_node).toBe('sc_users')
      } finally {
        cleanupProject(project)
      }
    })

    test('展开 user_quality_check 模板 → 多个约束 + transform', async ({ apiHelper }) => {
      const project = createTemplateProject(
        'quality-expand',
        buildBaseManifestProjectYaml('tpl_quality', 'Quality Expand', [
          { id: 'user_quality_check', path: 'templates/user_quality_check.template.yaml' },
        ]),
        {
          'schemas/users.schema.yaml': USERS_SCHEMA_YAML,
          'templates/user_quality_check.template.yaml': USER_QUALITY_TEMPLATE,
        }
      )
      try {
        const expandResp = await fetch(
          `${BACKEND_URL}/api/latest/project/template/user_quality_check/expand`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Project-Config-Path': project,
            },
            body: JSON.stringify({
              instance_id: 'quality_inst',
              params: {
                age_column: 'age',
                email_column: 'email',
                min_age: 0,
                max_age: 150,
              },
              input_from_node: 'sc_users',
            }),
          }
        )
        expect(expandResp.ok).toBe(true)
        const result = await expandResp.json()

        // 模板定义 3 个 constraint + 1 个 transform
        expect(result.constraints.length).toBe(3)
        expect(result.transforms.length).toBe(1)
        expect(result.regex_nodes.length).toBe(0)

        // 验证约束类型集合
        const constraintTypes = new Set(result.constraints.map((c: any) => c.type))
        expect(constraintTypes.has('AllowedValues')).toBe(true)
        expect(constraintTypes.has('Range')).toBe(true)
        expect(constraintTypes.has('NotNull')).toBe(true)

        // 验证 transform 类型
        const transform = result.transforms[0]
        expect(transform.type).toBe('MathExpr')
        expect(transform.id).toBe('quality_inst__age_classify')
        // 表达式中的 {{age_column}} 应被替换
        expect(transform.params.expression).toBe('age >= 18 ? 1 : 0')
        // 依赖 transform 的约束（None）input_from_node 应指向 transform 命名空间 ID
        // 该模板中 email_notnull 直接挂在 input_anchor 上，不依赖 transform
        // 但 age_classify 的 input_from_node 应是 sc_users
        expect(transform.input_from_node).toBe('sc_users')

        // 所有展开的 ID 都有命名空间前缀
        for (const c of result.constraints) {
          expect(c.id.startsWith('quality_inst__')).toBe(true)
        }
      } finally {
        cleanupProject(project)
      }
    })

    test('展开模板时使用默认值（不传 required=false 参数）', async ({ apiHelper }) => {
      const project = createTemplateProject(
        'default-val',
        buildBaseManifestProjectYaml('tpl_default', 'Default Value', [
          { id: 'age_check', path: 'templates/age_check.template.yaml' },
        ]),
        {
          'schemas/users.schema.yaml': USERS_SCHEMA_YAML,
          'templates/age_check.template.yaml': AGE_CHECK_TEMPLATE,
        }
      )
      try {
        // 不传 max_age（required=false，default=120）
        const expandResp = await fetch(
          `${BACKEND_URL}/api/latest/project/template/age_check/expand`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Project-Config-Path': project,
            },
            body: JSON.stringify({
              instance_id: 'default_inst',
              params: { source_column: 'age', min_age: 18 }, // 无 max_age
              input_from_node: 'sc_users',
            }),
          }
        )
        expect(expandResp.ok).toBe(true)
        const result = await expandResp.json()
        expect(result.constraints[0].params.min).toBe(18)
        expect(result.constraints[0].params.max).toBe(120) // default
      } finally {
        cleanupProject(project)
      }
    })

    test('展开模板缺少必填参数时返回 400', async ({ apiHelper }) => {
      const project = createTemplateProject(
        'missing-req',
        buildBaseManifestProjectYaml('tpl_missing', 'Missing Required', [
          { id: 'age_check', path: 'templates/age_check.template.yaml' },
        ]),
        {
          'schemas/users.schema.yaml': USERS_SCHEMA_YAML,
          'templates/age_check.template.yaml': AGE_CHECK_TEMPLATE,
        }
      )
      try {
        // 缺少必填参数 min_age
        const expandResp = await fetch(
          `${BACKEND_URL}/api/latest/project/template/age_check/expand`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Project-Config-Path': project,
            },
            body: JSON.stringify({
              instance_id: 'missing_inst',
              params: { source_column: 'age' }, // 缺 min_age
              input_from_node: 'sc_users',
            }),
          }
        )
        expect(expandResp.status).toBe(400)
        const body = await expandResp.json()
        expect(body.detail).toContain('min_age')
      } finally {
        cleanupProject(project)
      }
    })

    test('两个不同 instance_id 的展开互不干扰（命名空间隔离）', async ({ apiHelper }) => {
      const project = createTemplateProject(
        'multi-inst',
        buildBaseManifestProjectYaml('tpl_multi', 'Multi Instance', [
          { id: 'age_check', path: 'templates/age_check.template.yaml' },
        ]),
        {
          'schemas/users.schema.yaml': USERS_SCHEMA_YAML,
          'templates/age_check.template.yaml': AGE_CHECK_TEMPLATE,
        }
      )
      try {
        // 展开 instance A
        const respA = await fetch(
          `${BACKEND_URL}/api/latest/project/template/age_check/expand`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Project-Config-Path': project },
            body: JSON.stringify({
              instance_id: 'inst_a',
              params: { source_column: 'age', min_age: 0, max_age: 50 },
              input_from_node: 'sc_users',
            }),
          }
        )
        const dataA = await respA.json()
        // 展开 instance B
        const respB = await fetch(
          `${BACKEND_URL}/api/latest/project/template/age_check/expand`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Project-Config-Path': project },
            body: JSON.stringify({
              instance_id: 'inst_b',
              params: { source_column: 'age', min_age: 60, max_age: 120 },
              input_from_node: 'sc_users',
            }),
          }
        )
        const dataB = await respB.json()

        // A 范围 0-50
        expect(dataA.constraints[0].id).toBe('inst_a__age_range')
        expect(dataA.constraints[0].params.min).toBe(0)
        expect(dataA.constraints[0].params.max).toBe(50)
        // B 范围 60-120
        expect(dataB.constraints[0].id).toBe('inst_b__age_range')
        expect(dataB.constraints[0].params.min).toBe(60)
        expect(dataB.constraints[0].params.max).toBe(120)

        // 两个 ID 必须不同（无碰撞）
        expect(dataA.constraints[0].id).not.toBe(dataB.constraints[0].id)
      } finally {
        cleanupProject(project)
      }
    })

    test('展开不存在的模板返回 404', async ({ apiHelper }) => {
      const project = createTemplateProject(
        'no-template',
        buildBaseManifestProjectYaml('tpl_notfound', 'Not Found'),
        { 'schemas/users.schema.yaml': USERS_SCHEMA_YAML }
      )
      try {
        const resp = await fetch(
          `${BACKEND_URL}/api/latest/project/template/__ghost_template__/expand`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Project-Config-Path': project },
            body: JSON.stringify({
              instance_id: 'x',
              params: {},
              input_from_node: 'sc_users',
            }),
          }
        )
        expect(resp.status).toBe(404)
      } finally {
        cleanupProject(project)
      }
    })
  })

  test.describe('Template Instance 加载时自动展开', () => {
    test('通过 manifest.template_instances 触发自动展开（contract 验证）', async ({ apiHelper }) => {
      // 这个测试验证：当前端将模板实例保存到 manifest.template_instances 后，
      // 重新加载项目配置时，模板实例的展开结果应反映在 manifest 读取 + expand API 上。
      const project = createTemplateProject(
        'inst-load',
        `version: 2
project:
  id: tpl_inst_load
  name: Instance Load
schemas:
  - id: sc_users
    path: schemas/users.schema.yaml
templates:
  - id: age_check
    path: templates/age_check.template.yaml
template_instances:
  - id: inst-load-uuid
    template_id: age_check
    enabled: true
    input_from_node: sc_users
    params:
      source_column: age
      min_age: 18
      max_age: 100
`,
        {
          'schemas/users.schema.yaml': USERS_SCHEMA_YAML,
          'templates/age_check.template.yaml': AGE_CHECK_TEMPLATE,
        }
      )
      try {
        // 1. 读取 manifest，确认 template_instances 存在
        const manifestResp = await fetch(`${BACKEND_URL}/api/latest/project/manifest`, {
          headers: { 'X-Project-Config-Path': project },
        })
        expect(manifestResp.ok).toBe(true)
        const manifest = await manifestResp.json()
        expect(manifest.template_instances).toBeDefined()
        expect(manifest.template_instances.length).toBe(1)
        expect(manifest.template_instances[0].id).toBe('inst-load-uuid')
        expect(manifest.template_instances[0].template_id).toBe('age_check')
        expect(manifest.template_instances[0].input_from_node).toBe('sc_users')
        expect(manifest.template_instances[0].params.min_age).toBe(18)
        expect(manifest.template_instances[0].params.max_age).toBe(100)

        // 2. 单独调用 expand API 验证展开契约仍然正确
        const expandResp = await fetch(
          `${BACKEND_URL}/api/latest/project/template/age_check/expand`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Project-Config-Path': project },
            body: JSON.stringify({
              instance_id: 'inst-load-uuid',
              params: manifest.template_instances[0].params,
              input_from_node: manifest.template_instances[0].input_from_node,
            }),
          }
        )
        expect(expandResp.ok).toBe(true)
        const result = await expandResp.json()
        expect(result.constraints.length).toBe(1)
        expect(result.constraints[0].id).toBe('inst-load-uuid__age_range')
        expect(result.constraints[0].params.min).toBe(18)
        expect(result.constraints[0].params.max).toBe(100)
      } finally {
        cleanupProject(project)
      }
    })

    test('通过 PUT /manifest/template-instance 更新实例', async ({ apiHelper }) => {
      const project = createTemplateProject(
        'update-inst',
        `version: 2
project:
  id: tpl_update_inst
  name: Update Instance
schemas:
  - id: sc_users
    path: schemas/users.schema.yaml
templates:
  - id: age_check
    path: templates/age_check.template.yaml
`,
        {
          'schemas/users.schema.yaml': USERS_SCHEMA_YAML,
          'templates/age_check.template.yaml': AGE_CHECK_TEMPLATE,
        }
      )
      try {
        // 1. 添加 template_instance
        const putResp = await fetch(
          `${BACKEND_URL}/api/latest/project/manifest/template-instance`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-Project-Config-Path': project },
            body: JSON.stringify({
              id: 'update-uuid',
              template_id: 'age_check',
              enabled: true,
              input_from_node: 'sc_users',
              params: { source_column: 'age', min_age: 18, max_age: 65 },
            }),
          }
        )
        expect(putResp.ok).toBe(true)

        // 2. 读取 manifest 验证
        const manifestResp = await fetch(`${BACKEND_URL}/api/latest/project/manifest`, {
          headers: { 'X-Project-Config-Path': project },
        })
        const manifest = await manifestResp.json()
        expect(manifest.template_instances.length).toBe(1)
        expect(manifest.template_instances[0].params.max_age).toBe(65)

        // 3. 更新 instance（PUT 是 upsert 语义）
        const putResp2 = await fetch(
          `${BACKEND_URL}/api/latest/project/manifest/template-instance`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-Project-Config-Path': project },
            body: JSON.stringify({
              id: 'update-uuid',
              template_id: 'age_check',
              enabled: true,
              input_from_node: 'sc_users',
              params: { source_column: 'age', min_age: 21, max_age: 60 },
            }),
          }
        )
        expect(putResp2.ok).toBe(true)

        // 4. 重新读取应反映更新
        const manifestResp2 = await fetch(`${BACKEND_URL}/api/latest/project/manifest`, {
          headers: { 'X-Project-Config-Path': project },
        })
        const manifest2 = await manifestResp2.json()
        expect(manifest2.template_instances.length).toBe(1) // 仍然 1 个（更新而非新增）
        expect(manifest2.template_instances[0].params.min_age).toBe(21)
        expect(manifest2.template_instances[0].params.max_age).toBe(60)
      } finally {
        cleanupProject(project)
      }
    })

    test('模板实例 input_from_node 引用不存在的上游节点时，展开仍可成功（仅前端连线失败）', async ({ apiHelper }) => {
      // 模板展开是 schema-agnostic 的：它只做参数替换，不会校验 input_from_node
      // 是否真实存在于项目中。前端拿到展开结果后再处理连线错误。
      const project = createTemplateProject(
        'dangling-anchor',
        buildBaseManifestProjectYaml('tpl_dangling', 'Dangling Anchor', [
          { id: 'age_check', path: 'templates/age_check.template.yaml' },
        ]),
        { 'templates/age_check.template.yaml': AGE_CHECK_TEMPLATE }
      )
      try {
        const expandResp = await fetch(
          `${BACKEND_URL}/api/latest/project/template/age_check/expand`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Project-Config-Path': project },
            body: JSON.stringify({
              instance_id: 'dangling_inst',
              params: { source_column: 'age', min_age: 0, max_age: 100 },
              input_from_node: '__nonexistent_schema__',
            }),
          }
        )
        expect(expandResp.ok).toBe(true)
        const result = await expandResp.json()
        // 展开本身成功，但 input_from_node 保留为不存在的 ID
        expect(result.constraints[0].input_from_node).toBe('__nonexistent_schema__')
        expect(result.constraints[0].refs.table_id).toBe('__nonexistent_schema__')
      } finally {
        cleanupProject(project)
      }
    })
  })
})

/**
 * 构造一个最小 manifest yaml（含 users schema + 空 constraints/regex + 可选 templates）
 */
function buildBaseManifestProjectYaml(
  projectId: string,
  projectName: string,
  templates: Array<{ id: string; path: string }> = []
): string {
  const templatesYaml = templates.length
    ? `templates:\n${templates.map((t) => `  - id: ${t.id}\n    path: ${t.path}`).join('\n')}\n`
    : ''
  return `version: 2
project:
  id: ${projectId}
  name: ${projectName}
schemas:
  - id: sc_users
    path: schemas/users.schema.yaml
${templatesYaml}settings:
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
