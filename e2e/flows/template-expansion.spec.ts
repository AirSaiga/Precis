/**
 * @fileoverview E2E 模板展开验证测试
 *
 * 验证「自包含 DAG 蓝图」模板模型的 API 契约：
 * 模板由 manualData → transform* → constraint+ 组成，节点携带完整默认值，
 * 无参数占位符替换、无 input_anchor。展开时仅做命名空间 ID 改写
 * （{instance_id}__{local_id}）与内部引用解析。
 *
 * 覆盖：
 * 1. Template CRUD：创建（校验自包含）→ 列出 → 读取 → 不存在 404
 * 2. Expand API 契约：命名空间 ID、节点原样透传、manual_data 数组、
 *    非法模板 400、多实例命名空间隔离、不存在模板 404
 * 3. manifest template-instance：PUT upsert 语义 + 读取
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
  // 对齐后端 _create_minimal_project：manual_data 目录用于新模型
  const dirs = ['schemas', 'constraints', 'data', 'templates', 'manual_data']
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
 * 基础年龄范围模板（自包含 DAG：manualData → Range 约束，2 节点）
 */
const AGE_CHECK_TEMPLATE = `version: 2
id: age_check
name: 年龄范围校验
description: 校验年龄是否在指定范围内
nodes:
  - id: md_input
    kind: manualData
    type: ManualData
    column_name: age
    column_data_type: integer
    rows:
      - ["18"]
      - ["25"]
      - ["65"]
    enabled: true
    description: 输入数据起点
  - id: check_range
    kind: constraint
    type: Range
    input_from_node: md_input
    refs:
      table_id: md_input
      column_id: age
    params:
      min: 0
      max: 120
      boundary_mode: inclusive
    enabled: true
    description: 年龄范围 [0, 120]
`

/**
 * 复合模板（manualData → transform → AllowedValues；另含一条 NotNull 直连 manualData，4 节点）
 */
const USER_QUALITY_TEMPLATE = `version: 2
id: user_quality_check
name: 用户数据质量综合校验
description: 对输入做标准化后多维度质量校验
nodes:
  - id: md_input
    kind: manualData
    type: ManualData
    column_name: text_field
    column_data_type: string
    rows:
      - ["cn"]
      - ["us"]
      - ["uk"]
    enabled: true
    description: 输入数据起点
  - id: normalize
    kind: transform
    type: UpperCase
    input_from_node: md_input
    input_column: text_field
    output_columns:
      - text_upper
    params: {}
    enabled: true
    description: 将输入列转为大写
  - id: check_allowed
    kind: constraint
    type: AllowedValues
    input_from_node: normalize
    input_column: text_upper
    refs:
      table_id: normalize
      column_id: text_upper
    params:
      allowed_values:
        - CN
        - US
        - UK
        - JP
    enabled: true
    description: 校验标准化后的枚举值
  - id: check_notnull
    kind: constraint
    type: NotNull
    input_from_node: md_input
    refs:
      table_id: md_input
      column_id: text_field
    params: {}
    enabled: true
    description: 原始字段非空校验
`

/**
 * 基础 manifest with users schema
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

test.describe('Template Expansion E2E', () => {
  test.describe('Template CRUD', () => {
    test('创建模板 → 读取 → 列出', async () => {
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
        // 1. 列出模板（直接 fetch，X-Project-Config-Path 指向临时项目）
        const listResp = await fetch(`${BACKEND_URL}/api/latest/project/template`, {
          headers: { 'X-Project-Config-Path': project },
        })
        expect(listResp.ok).toBe(true)
        const directTemplates = await listResp.json()
        expect(directTemplates.length).toBe(1)
        expect(directTemplates[0].id).toBe('age_check')
        expect(directTemplates[0].name).toBe('年龄范围校验')
        // 自包含 DAG 模型：列表项只有 node_count（节点数），无 parameter_count
        expect(directTemplates[0].node_count).toBe(2)
        expect(directTemplates[0].path).toBe('templates/age_check.template.yaml')

        // 2. 按 ID 读取模板
        const getResp = await fetch(`${BACKEND_URL}/api/latest/project/template/age_check`, {
          headers: { 'X-Project-Config-Path': project },
        })
        expect(getResp.ok).toBe(true)
        const tpl = await getResp.json()
        expect(tpl.id).toBe('age_check')
        expect(tpl.name).toBe('年龄范围校验')
        // 新模型：返回 nodes（DAG 节点），无 parameters / input_anchor
        expect(Array.isArray(tpl.nodes)).toBe(true)
        expect(tpl.nodes.length).toBe(2)
        const kinds = tpl.nodes.map((n: any) => n.kind)
        expect(kinds).toContain('manualData')
        expect(kinds).toContain('constraint')
        const rangeNode = tpl.nodes.find((n: any) => n.kind === 'constraint')
        expect(rangeNode.type).toBe('Range')
      } finally {
        cleanupProject(project)
      }
    })

    test('读取不存在的模板返回 404', async () => {
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
    test('展开 age_check 模板 → 命名空间 ID + 节点原样透传', async () => {
      const project = createTemplateProject(
        'age-expand',
        buildBaseManifestProjectYaml('tpl_age_expand', 'Age Expand', [
          { id: 'age_check', path: 'templates/age_check.template.yaml' },
        ]),
        { 'templates/age_check.template.yaml': AGE_CHECK_TEMPLATE }
      )
      try {
        // 新模型 expand 请求体仅含 instance_id（无 params / input_from_node）
        const expandResp = await fetch(
          `${BACKEND_URL}/api/latest/project/template/age_check/expand`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Project-Config-Path': project,
            },
            body: JSON.stringify({ instance_id: 'age_check_inst' }),
          }
        )
        expect(expandResp.ok).toBe(true)
        const result = await expandResp.json()

        // 1 个 manualData + 1 个 constraint，无 transform / regex
        expect(result.manual_data.length).toBe(1)
        expect(result.constraints.length).toBe(1)
        expect(result.transforms).toEqual([])
        expect(result.regex_nodes).toEqual([])

        // 命名空间 ID 格式：{instance_id}__{local_id}
        expect(result.manual_data[0].id).toBe('age_check_inst__md_input')
        expect(result.constraints[0].id).toBe('age_check_inst__check_range')

        // 节点值原样透传（非占位符替换）
        expect(result.constraints[0].type).toBe('Range')
        expect(result.constraints[0].params.min).toBe(0)
        expect(result.constraints[0].params.max).toBe(120)
        // 内部引用 input_from_node 改写为命名空间 ID
        expect(result.constraints[0].input_from_node).toBe('age_check_inst__md_input')

        // manualData 数据原样
        expect(result.manual_data[0].column_name).toBe('age')
        expect(result.manual_data[0].column_data_type).toBe('integer')
        expect(result.manual_data[0].rows).toEqual([['18'], ['25'], ['65']])
      } finally {
        cleanupProject(project)
      }
    })

    test('展开 user_quality_check 模板 → transform + 多约束', async () => {
      const project = createTemplateProject(
        'quality-expand',
        buildBaseManifestProjectYaml('tpl_quality', 'Quality Expand', [
          { id: 'user_quality_check', path: 'templates/user_quality_check.template.yaml' },
        ]),
        { 'templates/user_quality_check.template.yaml': USER_QUALITY_TEMPLATE }
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
            body: JSON.stringify({ instance_id: 'quality_inst' }),
          }
        )
        expect(expandResp.ok).toBe(true)
        const result = await expandResp.json()

        // 4 个节点展开：1 manualData + 1 transform + 2 constraint
        expect(result.manual_data.length).toBe(1)
        expect(result.transforms.length).toBe(1)
        expect(result.constraints.length).toBe(2)
        expect(result.regex_nodes).toEqual([])

        // 验证约束类型集合
        const constraintTypes = new Set(result.constraints.map((c: any) => c.type))
        expect(constraintTypes.has('AllowedValues')).toBe(true)
        expect(constraintTypes.has('NotNull')).toBe(true)

        // 验证 transform：input_from_node 指向 manualData 命名空间 ID
        const transform = result.transforms[0]
        expect(transform.type).toBe('UpperCase')
        expect(transform.id).toBe('quality_inst__normalize')
        expect(transform.input_from_node).toBe('quality_inst__md_input')
        // output_columns 原样
        expect(transform.output_columns).toEqual(['text_upper'])

        // 依赖 transform 的约束：input_from_node 指向 transform 命名空间 ID
        const allowedConstraint = result.constraints.find((c: any) => c.type === 'AllowedValues')
        expect(allowedConstraint.input_from_node).toBe('quality_inst__normalize')

        // 直连 manualData 的约束：input_from_node 指向 manualData 命名空间 ID
        const notNullConstraint = result.constraints.find((c: any) => c.type === 'NotNull')
        expect(notNullConstraint.input_from_node).toBe('quality_inst__md_input')

        // 所有展开的 ID 都有命名空间前缀
        for (const c of result.constraints) {
          expect(c.id.startsWith('quality_inst__')).toBe(true)
        }
      } finally {
        cleanupProject(project)
      }
    })

    test('展开模板 → 返回 manual_data 数组（字段完整）', async () => {
      const project = createTemplateProject(
        'manual-data',
        buildBaseManifestProjectYaml('tpl_md', 'Manual Data', [
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
            body: JSON.stringify({ instance_id: 'md_inst' }),
          }
        )
        expect(expandResp.ok).toBe(true)
        const result = await expandResp.json()

        // manual_data 数组必须存在且字段完整
        expect(Array.isArray(result.manual_data)).toBe(true)
        expect(result.manual_data.length).toBe(1)
        const md = result.manual_data[0]
        expect(md.id).toBe('md_inst__md_input')
        expect(md.column_name).toBe('age')
        expect(md.column_data_type).toBe('integer')
        expect(md.rows).toEqual([['18'], ['25'], ['65']])
        expect(md.enabled).toBe(true)
      } finally {
        cleanupProject(project)
      }
    })

    test('创建非法模板（缺少 manualData 节点）返回 400', async () => {
      const project = createTemplateProject('no-manualdata', buildBaseManifestProjectYaml('tpl_nm', 'No ManualData'))
      try {
        // 只有 constraint 的模板：违反「至少 1 个 manualData」规则
        const resp = await fetch(`${BACKEND_URL}/api/latest/project/template`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Project-Config-Path': project },
          body: JSON.stringify({
            version: 2,
            id: 'bad_no_manual',
            name: '非法模板',
            nodes: [
              {
                id: 'c1',
                kind: 'constraint',
                type: 'NotNull',
                input_from_node: 'md1',
                refs: {},
                params: {},
              },
            ],
          }),
        })
        expect(resp.status).toBe(400)
        const body = await resp.json()
        expect(body.detail).toContain('manualData')
      } finally {
        cleanupProject(project)
      }
    })

    test('创建非法模板（引用外部节点）返回 400', async () => {
      const project = createTemplateProject('ext-ref', buildBaseManifestProjectYaml('tpl_ext', 'External Ref'))
      try {
        // constraint 引用模板外部节点：违反「模板必须自包含」规则
        const resp = await fetch(`${BACKEND_URL}/api/latest/project/template`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Project-Config-Path': project },
          body: JSON.stringify({
            version: 2,
            id: 'bad_external',
            name: '非法模板',
            nodes: [
              {
                id: 'md_age',
                kind: 'manualData',
                type: 'ManualData',
                column_name: 'age',
                column_data_type: 'integer',
                rows: [['18']],
              },
              {
                id: 'check_range',
                kind: 'constraint',
                type: 'Range',
                input_from_node: 'external_node',
                refs: {},
                params: { min: 0, max: 120 },
              },
            ],
          }),
        })
        expect(resp.status).toBe(400)
        const body = await resp.json()
        expect(body.detail).toContain('自包含')
      } finally {
        cleanupProject(project)
      }
    })

    test('两个不同 instance_id 的展开互不干扰（命名空间隔离）', async () => {
      const project = createTemplateProject(
        'multi-inst',
        buildBaseManifestProjectYaml('tpl_multi', 'Multi Instance', [
          { id: 'age_check', path: 'templates/age_check.template.yaml' },
        ]),
        { 'templates/age_check.template.yaml': AGE_CHECK_TEMPLATE }
      )
      try {
        // 展开 instance A
        const respA = await fetch(
          `${BACKEND_URL}/api/latest/project/template/age_check/expand`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Project-Config-Path': project },
            body: JSON.stringify({ instance_id: 'inst_a' }),
          }
        )
        expect(respA.ok).toBe(true)
        const dataA = await respA.json()
        // 展开 instance B
        const respB = await fetch(
          `${BACKEND_URL}/api/latest/project/template/age_check/expand`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Project-Config-Path': project },
            body: JSON.stringify({ instance_id: 'inst_b' }),
          }
        )
        expect(respB.ok).toBe(true)
        const dataB = await respB.json()

        // 命名空间前缀不同：A 用 inst_a__，B 用 inst_b__
        expect(dataA.constraints[0].id).toBe('inst_a__check_range')
        expect(dataB.constraints[0].id).toBe('inst_b__check_range')
        // 两个 ID 必须不同（无碰撞）
        expect(dataA.constraints[0].id).not.toBe(dataB.constraints[0].id)
        // 节点值相同（来自同一模板），但命名空间隔离
        expect(dataA.constraints[0].params.min).toBe(0)
        expect(dataB.constraints[0].params.min).toBe(0)
      } finally {
        cleanupProject(project)
      }
    })

    test('展开不存在的模板返回 404', async () => {
      const project = createTemplateProject('no-template', buildBaseManifestProjectYaml('tpl_notfound', 'Not Found'))
      try {
        const resp = await fetch(
          `${BACKEND_URL}/api/latest/project/template/__ghost_template__/expand`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Project-Config-Path': project },
            body: JSON.stringify({ instance_id: 'x' }),
          }
        )
        expect(resp.status).toBe(404)
      } finally {
        cleanupProject(project)
      }
    })
  })

  test.describe('Template Instance（manifest）', () => {
    test('PUT /manifest/template-instance upsert + 读取', async () => {
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
        { 'templates/age_check.template.yaml': AGE_CHECK_TEMPLATE }
      )
      try {
        // 1. 添加 template_instance（新模型 TemplateInstanceRef 仅 {id, template_id, enabled}）
        const putResp = await fetch(
          `${BACKEND_URL}/api/latest/project/manifest/template-instance`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-Project-Config-Path': project },
            body: JSON.stringify({
              id: 'update-uuid',
              template_id: 'age_check',
              enabled: true,
            }),
          }
        )
        expect(putResp.ok).toBe(true)

        // 2. 读取 manifest 验证
        const manifestResp = await fetch(`${BACKEND_URL}/api/latest/project/manifest`, {
          headers: { 'X-Project-Config-Path': project },
        })
        expect(manifestResp.ok).toBe(true)
        const manifest = await manifestResp.json()
        expect(manifest.template_instances).toBeDefined()
        expect(manifest.template_instances.length).toBe(1)
        const inst = manifest.template_instances[0]
        expect(inst.id).toBe('update-uuid')
        expect(inst.template_id).toBe('age_check')
        expect(inst.enabled).toBe(true)

        // 3. 更新 instance（PUT 是 upsert 语义）：改 enabled=false
        const putResp2 = await fetch(
          `${BACKEND_URL}/api/latest/project/manifest/template-instance`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-Project-Config-Path': project },
            body: JSON.stringify({
              id: 'update-uuid',
              template_id: 'age_check',
              enabled: false,
            }),
          }
        )
        expect(putResp2.ok).toBe(true)

        // 4. 重新读取应反映更新（仍 1 条，upsert 而非新增）
        const manifestResp2 = await fetch(`${BACKEND_URL}/api/latest/project/manifest`, {
          headers: { 'X-Project-Config-Path': project },
        })
        const manifest2 = await manifestResp2.json()
        expect(manifest2.template_instances.length).toBe(1)
        expect(manifest2.template_instances[0].enabled).toBe(false)
      } finally {
        cleanupProject(project)
      }
    })
  })
})
