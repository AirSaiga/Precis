/**
 * @fileoverview Persistence 层单元测试
 *
 * 覆盖新 persistence 架构的核心组件：
 * - Builder Registry 自注册
 * - 工具函数（schema ID 映射、节点过滤）
 * - 内嵌/独立约束分类器
 * - 内嵌约束 builder
 * - 独立约束 builders（10 种类型采样）
 * - Schema builder
 * - SavePlan builder 完整流程
 * - Pre-Validator
 * - SaveOrchestrator（mock API）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CustomNode, SchemaNodeData } from '@/types/graph'
import type { ConstraintFileV2 } from '@/types/projectV2'

// 触发所有 builder 注册
import '@/services/persistence'

import {
  getAllBuilders,
  findBuilderFor,
  findBuildersByKind,
  clearBuildersForTest,
} from '@/services/persistence/builders/registry'
import { buildSchemaIdByNodeId, filterPersistentNodes } from '@/services/persistence/utils'
import {
  shouldEmbedInSchema,
  classifyConstraints,
} from '@/services/persistence/embedders/embeddedSelector'
import {
  buildEmbeddedConstraintItem,
  CompositeCannotEmbedError,
} from '@/services/persistence/embedders/embeddedConstraintBuilder'
import { buildSavePlan } from '@/services/persistence/planBuilder'
import { PreValidator } from '@/services/persistence/preValidator'
import { SaveOrchestrator } from '@/services/persistence/orchestrator'
import * as projectV2Api from '@/api/projectV2Api'

// ============================================================================
// 测试辅助函数
// ============================================================================

function makeSchemaNode(overrides: Partial<CustomNode> = {}): CustomNode {
  return {
    id: 'schema-1',
    type: 'schema',
    data: {
      tableName: 'users',
      columns: [
        { id: 'col-email', columnName: 'email' },
        { id: 'col-age', columnName: 'age' },
        { id: 'col-status', columnName: 'status' },
      ],
      sourceFilePath: '/data/users.csv',
      ...((overrides.data || {}) as any),
    } as SchemaNodeData,
    position: { x: 0, y: 0 },
    ...overrides,
  } as CustomNode
}

function makeConstraintNode(type: string, data: Record<string, unknown>, id = 'c-1'): CustomNode {
  return {
    id,
    type,
    data: data as any,
    position: { x: 0, y: 0 },
  } as CustomNode
}

function makeRegexNode(id = 'r-1'): CustomNode {
  return {
    id,
    type: 'regex',
    data: {
      configName: 'Email Pattern',
      pattern: '^[\\w.-]+@[\\w.-]+\\.\\w+$',
      matchMode: 'full',
      caseSensitive: false,
      flags: '',
      enabled: true,
      parameters: [],
      rules: [],
    } as any,
    position: { x: 0, y: 0 },
  } as CustomNode
}

function makeTransformNode(id = 't-1'): CustomNode {
  return {
    id,
    type: 'transform',
    data: {
      configName: 'Upper Case',
      transformType: 'UpperCase',
      enabled: true,
      params: {},
      outputColumns: ['upper_name'],
    } as any,
    position: { x: 0, y: 0 },
  } as CustomNode
}

function makeTemplateInstanceNode(id = 'ti-1'): CustomNode {
  return {
    id,
    type: 'templateInstance',
    data: {
      templateId: 'tpl-default',
      enabled: true,
      inputFromNode: 'schema-1',
      parameters: {},
    } as any,
    position: { x: 0, y: 0 },
  } as CustomNode
}

// ============================================================================
// Registry
// ============================================================================

describe('Persistence - Builder Registry', () => {
  it('导入 persistence 后注册表包含全部 builder', () => {
    const all = getAllBuilders()
    expect(all.length).toBeGreaterThan(0)
    expect(findBuildersByKind('schema').length).toBeGreaterThan(0)
    expect(findBuildersByKind('constraint').length).toBe(10)
    expect(findBuildersByKind('regex').length).toBeGreaterThan(0)
    expect(findBuildersByKind('transform').length).toBeGreaterThan(0)
    expect(findBuildersByKind('templateInstance').length).toBeGreaterThan(0)
  })
})

// ============================================================================
// Utils
// ============================================================================

describe('Persistence - Utils', () => {
  it('buildSchemaIdByNodeId 为 schema 生成确定性 ID', () => {
    const schema = makeSchemaNode()
    const map = buildSchemaIdByNodeId([schema])
    expect(map['schema-1']).toBeTruthy()
    expect(typeof map['schema-1']).toBe('string')
  })

  it('filterPersistentNodes 排除模板展开预览节点', () => {
    const normal = makeSchemaNode()
    const expanded = makeConstraintNode('notNullConstraint', { configName: 'tmp' }, 'c-expanded')
    ;(expanded.data as any)._expandedFromInstanceId = 'ti-1'

    const result = filterPersistentNodes([normal, expanded])
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('schema-1')
  })
})

// ============================================================================
// Embedded Selector
// ============================================================================

describe('Persistence - Embedded Selector', () => {
  const schema = makeSchemaNode()

  it('Composite 强制独立', () => {
    const composite = makeConstraintNode('compositeConstraint', { logic: 'all' })
    expect(shouldEmbedInSchema(composite, [schema])).toBe(false)
  })

  it('显式 embedded=true 强制内嵌', () => {
    const nn = makeConstraintNode('notNullConstraint', { embedded: true })
    expect(shouldEmbedInSchema(nn, [schema])).toBe(true)
  })

  it('sourceRef 指向 schema 则内嵌', () => {
    const nn = makeConstraintNode('notNullConstraint', {
      sourceRef: { nodeId: 'schema-1', columnId: 'col-email' },
    })
    expect(shouldEmbedInSchema(nn, [schema])).toBe(true)
  })

  it('sourceRef 指向不存在的节点则独立', () => {
    const nn = makeConstraintNode('notNullConstraint', {
      sourceRef: { nodeId: 'missing', columnId: 'col-x' },
    })
    expect(shouldEmbedInSchema(nn, [schema])).toBe(false)
  })

  it('classifyConstraints 正确分组', () => {
    const embedded = makeConstraintNode(
      'notNullConstraint',
      {
        sourceRef: { nodeId: 'schema-1', columnId: 'col-email' },
      },
      'c-emb'
    )
    const standalone = makeConstraintNode('compositeConstraint', { logic: 'all' }, 'c-std')

    const { embedded: e, standalone: s } = classifyConstraints([embedded, standalone], [schema])
    expect(e.map((n) => n.id)).toEqual(['c-emb'])
    expect(s.map((n) => n.id)).toEqual(['c-std'])
  })
})

// ============================================================================
// Embedded Constraint Builder
// ============================================================================

describe('Persistence - Embedded Constraint Builder', () => {
  it('NotNull 生成无 refs 的 ConstraintItemV2', () => {
    const node = makeConstraintNode('notNullConstraint', {
      configName: '非空',
      column: 'email',
    })

    const item = buildEmbeddedConstraintItem(node)
    expect(item.type).toBe('NotNull')
    expect(item.column).toBe('email')
    expect(item.params).toEqual({})
    expect('refs' in item).toBe(false)
  })

  it('Range 保留 boundary_mode', () => {
    const node = makeConstraintNode('rangeConstraint', {
      column: 'age',
      minValue: 0,
      maxValue: 150,
      boundaryMode: 'exclusive',
    })

    const item = buildEmbeddedConstraintItem(node)
    expect(item.type).toBe('Range')
    expect(item.params).toEqual({ min: 0, max: 150, boundary_mode: 'exclusive' })
  })

  it('Charset 保留 allowed_chars / disallowed_chars', () => {
    const node = makeConstraintNode('charsetConstraint', {
      column: 'status',
      charsetMode: 'custom',
      allowedChars: '0123456789',
      disallowedChars: 'abcdef',
    })

    const item = buildEmbeddedConstraintItem(node)
    expect(item.params).toEqual({
      charset_mode: 'custom',
      allowed_chars: '0123456789',
      disallowed_chars: 'abcdef',
    })
  })

  it('Composite 内嵌时抛出错误', () => {
    const node = makeConstraintNode('compositeConstraint', { logic: 'all' })
    expect(() => buildEmbeddedConstraintItem(node)).toThrow(CompositeCannotEmbedError)
  })
})

// ============================================================================
// Standalone Constraint Builders
// ============================================================================

describe('Persistence - Standalone Constraint Builders', () => {
  const schema = makeSchemaNode()
  const schemaIdByNodeId = buildSchemaIdByNodeId([schema])

  it('notNull builder 生成完整 ConstraintFileV2', () => {
    const node = makeConstraintNode('notNullConstraint', {
      configName: '邮箱非空',
      sourceRef: { nodeId: 'schema-1', columnId: 'col-email' },
    })

    const builder = findBuilderFor(node)
    expect(builder).toBeTruthy()

    const { file } = builder!.build({
      nodes: [schema, node],
      node,
      schemaIdByNodeId,
      configPath: '/tmp',
    })
    const f = file as ConstraintFileV2
    expect(f.type).toBe('NotNull')
    expect(f.refs.table_id).toBe(schemaIdByNodeId['schema-1'])
    expect(f.refs.column_id).toBe('col-email')
  })

  it('range builder 保留 boundary_mode', () => {
    const node = makeConstraintNode('rangeConstraint', {
      configName: '年龄范围',
      sourceRef: { nodeId: 'schema-1', columnId: 'col-age' },
      minValue: 0,
      maxValue: 150,
      boundaryMode: 'exclusive',
    })

    const builder = findBuilderFor(node)!
    const { file } = builder.build({
      nodes: [schema, node],
      node,
      schemaIdByNodeId,
      configPath: '/tmp',
    })
    expect(file.params).toEqual({ min: 0, max: 150, boundary_mode: 'exclusive' })
  })

  it('composite builder 收集子约束', () => {
    const sub1 = makeConstraintNode('notNullConstraint', { configName: '子1' }, 'c-sub-1')
    const sub2 = makeConstraintNode(
      'rangeConstraint',
      { configName: '子2', minValue: 0, maxValue: 10 },
      'c-sub-2'
    )
    const composite = makeConstraintNode(
      'compositeConstraint',
      {
        configName: '复合',
        logic: 'all',
        includedNodeIds: ['c-sub-1', 'c-sub-2'],
      },
      'c-composite'
    )

    const builder = findBuilderFor(composite)!
    const { file } = builder.build({
      nodes: [schema, sub1, sub2, composite],
      node: composite,
      schemaIdByNodeId,
      configPath: '/tmp',
    })

    expect(file.type).toBe('Composite')
    expect(file.params.logic).toBe('all')
    expect(file.params.sub_constraints).toHaveLength(2)
    expect((file.params.sub_constraints as any[])[0].id).toBe('c-sub-1')
    expect((file.params.sub_constraints as any[])[1].id).toBe('c-sub-2')
  })
})

// ============================================================================
// Schema Builder
// ============================================================================

describe('Persistence - Schema Builder', () => {
  it('schema 节点生成 TableSchemaFileV2', () => {
    const schema = makeSchemaNode()
    const builder = findBuildersByKind('schema')[0]
    expect(builder).toBeTruthy()

    const { file } = builder.build({
      nodes: [schema],
      node: schema,
      schemaIdByNodeId: buildSchemaIdByNodeId([schema]),
      configPath: '/tmp',
    })

    expect(file.name).toBe('users')
    expect(file.source?.path).toBe('/data/users.csv')
    expect(file.columns).toHaveLength(3)
  })
})

// ============================================================================
// SavePlan Builder
// ============================================================================

describe('Persistence - SavePlan Builder', () => {
  it('空节点列表生成基础 manifest', () => {
    const plan = buildSavePlan([], { projectName: 'Test', projectPath: '/tmp/test' })
    expect(plan.manifest.project.name).toBe('Test')
    expect(plan.schemas.size).toBe(0)
    expect(plan.constraints.size).toBe(0)
  })

  it('schema + embedded 约束写入 schema 文件', () => {
    const schema = makeSchemaNode()
    const nn = makeConstraintNode(
      'notNullConstraint',
      {
        configName: '非空',
        sourceRef: { nodeId: 'schema-1', columnId: 'col-email' },
      },
      'c-nn'
    )

    const plan = buildSavePlan([schema, nn], { projectName: 'Test', projectPath: '/tmp/test' })
    const schemaPlan = Array.from(plan.schemas.values())[0]
    expect(schemaPlan.embeddedConstraintIds).toContain('c-nn')
    expect(schemaPlan.schemaFile.constraints).toHaveLength(1)
    expect(schemaPlan.schemaFile.constraints![0].type).toBe('NotNull')
  })

  it('standalone 约束写入 constraints Map', () => {
    const schema = makeSchemaNode()
    const composite = makeConstraintNode(
      'compositeConstraint',
      {
        configName: '复合',
        logic: 'all',
        includedNodeIds: [],
      },
      'c-composite'
    )

    const plan = buildSavePlan([schema, composite], {
      projectName: 'Test',
      projectPath: '/tmp/test',
    })
    expect(plan.constraints.has('c-composite')).toBe(true)
    expect(Array.from(plan.schemas.values())[0].schemaFile.constraints).toHaveLength(0)
  })

  it('regex / transform / templateInstance 分别写入对应集合', () => {
    const regex = makeRegexNode('r-1')
    const transform = makeTransformNode('t-1')
    const template = makeTemplateInstanceNode('ti-1')

    const plan = buildSavePlan([regex, transform, template], {
      projectName: 'Test',
      projectPath: '/tmp/test',
    })
    expect(plan.regexes.has('r-1')).toBe(true)
    expect(plan.transforms.has('t-1')).toBe(true)
    expect(plan.templateInstances.has('ti-1')).toBe(true)
    expect(plan.manifest.regex_nodes).toHaveLength(1)
    expect(plan.manifest.transforms).toHaveLength(1)
    expect(plan.manifest.template_instances).toHaveLength(1)
  })
})

// ============================================================================
// Pre-Validator
// ============================================================================

describe('Persistence - Pre-Validator', () => {
  it('检测到 schema 缺少数据源路径时生成 BLOCKER', () => {
    const schema = makeSchemaNode({
      data: {
        tableName: 'empty',
        columns: [{ id: 'c1', columnName: 'x' }],
        sourceFilePath: '',
      } as any,
    })

    const plan = buildSavePlan([schema], { projectName: 'Test', projectPath: '/tmp/test' })
    const validator = new PreValidator(plan, [schema])
    validator.validate()

    expect(validator.hasBlocker()).toBe(true)
    expect(validator.count('BLOCKER')).toBeGreaterThan(0)
  })

  it('检测到重复列 ID 时生成 BLOCKER', () => {
    const schema = makeSchemaNode({
      data: {
        tableName: 'dup',
        columns: [
          { id: 'c1', columnName: 'a' },
          { id: 'c1', columnName: 'b' },
        ],
        sourceFilePath: '/data/dup.csv',
      } as any,
    })

    const plan = buildSavePlan([schema], { projectName: 'Test', projectPath: '/tmp/test' })
    const validator = new PreValidator(plan, [schema])
    validator.validate()

    expect(validator.count('BLOCKER')).toBeGreaterThan(0)
  })

  it('standalone 约束引用不存在的 schema 生成 WARNING', () => {
    // 构造一个包含孤立约束引用的 plan：直接写入 constraints Map
    const plan = buildSavePlan([], { projectName: 'Test', projectPath: '/tmp/test' })
    plan.constraints.set('c-orphan', {
      version: 2,
      id: 'c-orphan',
      type: 'NotNull',
      enabled: true,
      refs: { table_id: 'nonexistent-schema' },
      params: {},
    } as any)

    const validator = new PreValidator(plan, [])
    validator.validate()

    expect(validator.count('WARNING')).toBeGreaterThan(0)
    expect(validator.hasBlocker()).toBe(false)
  })

  it('Schema 列 ID 缺失时生成 BLOCKER', () => {
    const schema = makeSchemaNode({
      data: {
        tableName: 'bad',
        columns: [{ id: '', columnName: 'x' }],
        sourceFilePath: '/data/bad.csv',
      } as any,
    })

    const plan = buildSavePlan([schema], { projectName: 'Test', projectPath: '/tmp/test' })
    const validator = new PreValidator(plan, [schema])
    validator.validate()

    expect(validator.hasBlocker()).toBe(true)
    expect(validator.count('BLOCKER')).toBeGreaterThanOrEqual(1)
  })

  it('Schema 列名缺失时生成 BLOCKER', () => {
    const schema = makeSchemaNode({
      data: {
        tableName: 'bad',
        columns: [{ id: 'c1', columnName: '' }],
        sourceFilePath: '/data/bad.csv',
      } as any,
    })

    const plan = buildSavePlan([schema], { projectName: 'Test', projectPath: '/tmp/test' })
    const validator = new PreValidator(plan, [schema])
    validator.validate()

    expect(validator.hasBlocker()).toBe(true)
  })

  it('Schema 无列时生成 WARNING', () => {
    const schema = makeSchemaNode({
      data: {
        tableName: 'empty',
        columns: [],
        sourceFilePath: '/data/empty.csv',
      } as any,
    })

    const plan = buildSavePlan([schema], { projectName: 'Test', projectPath: '/tmp/test' })
    const validator = new PreValidator(plan, [schema])
    validator.validate()

    expect(validator.count('WARNING')).toBeGreaterThan(0)
    expect(validator.hasBlocker()).toBe(false)
  })

  it('Range min > max 时生成 BLOCKER', () => {
    const plan = buildSavePlan([], { projectName: 'Test', projectPath: '/tmp/test' })
    plan.constraints.set('c-range', {
      version: 2,
      id: 'c-range',
      type: 'Range',
      enabled: true,
      refs: { table_id: 'sc_users', column_id: 'col-age' },
      params: { min: 100, max: 0 },
    } as any)

    const validator = new PreValidator(plan, [])
    validator.validate()

    expect(validator.hasBlocker()).toBe(true)
    expect(validator.count('BLOCKER')).toBeGreaterThanOrEqual(1)
  })

  it('Composite 自引用时生成 BLOCKER', () => {
    const plan = buildSavePlan([], { projectName: 'Test', projectPath: '/tmp/test' })
    plan.constraints.set('c-composite', {
      version: 2,
      id: 'c-composite',
      type: 'Composite',
      enabled: true,
      refs: {},
      params: {
        logic: 'all',
        sub_constraints: [
          { id: 'c-composite', type: 'NotNull', enabled: true, refs: {}, params: {} },
        ],
      },
    } as any)

    const validator = new PreValidator(plan, [])
    validator.validate()

    expect(validator.hasBlocker()).toBe(true)
    expect(validator.count('BLOCKER')).toBeGreaterThanOrEqual(1)
  })

  it('Composite 无子约束时生成 WARNING', () => {
    const plan = buildSavePlan([], { projectName: 'Test', projectPath: '/tmp/test' })
    plan.constraints.set('c-empty', {
      version: 2,
      id: 'c-empty',
      type: 'Composite',
      enabled: true,
      refs: {},
      params: { logic: 'all', sub_constraints: [] },
    } as any)

    const validator = new PreValidator(plan, [])
    validator.validate()

    expect(validator.count('WARNING')).toBeGreaterThan(0)
    expect(validator.hasBlocker()).toBe(false)
  })

  it('AllowedValues 空数组时生成 WARNING', () => {
    const plan = buildSavePlan([], { projectName: 'Test', projectPath: '/tmp/test' })
    plan.constraints.set('c-av', {
      version: 2,
      id: 'c-av',
      type: 'AllowedValues',
      enabled: true,
      refs: { table_id: 'sc_users', column_id: 'col-status' },
      params: { allowed_values: [] },
    } as any)

    const validator = new PreValidator(plan, [])
    validator.validate()

    expect(validator.count('WARNING')).toBeGreaterThan(0)
    expect(validator.hasBlocker()).toBe(false)
  })

  it('Scripted 表达式为空时生成 WARNING', () => {
    const plan = buildSavePlan([], { projectName: 'Test', projectPath: '/tmp/test' })
    plan.constraints.set('c-script', {
      version: 2,
      id: 'c-script',
      type: 'Scripted',
      enabled: true,
      refs: { table_id: 'sc_users', column_id: 'col-email' },
      params: { expression: '', name: 'test' },
    } as any)

    const validator = new PreValidator(plan, [])
    validator.validate()

    expect(validator.count('WARNING')).toBeGreaterThan(0)
    expect(validator.hasBlocker()).toBe(false)
  })

  it('Regex 语法无效时生成 BLOCKER', () => {
    const plan = buildSavePlan([], { projectName: 'Test', projectPath: '/tmp/test' })
    plan.regexes.set('r-bad', {
      version: 2,
      id: 'r-bad',
      name: 'Bad Regex',
      pattern: '[invalid(',
      match_mode: 'full',
      case_sensitive: false,
      flags: '',
      enabled: true,
      parameters: [],
      rules: [],
    } as any)

    const validator = new PreValidator(plan, [])
    validator.validate()

    expect(validator.hasBlocker()).toBe(true)
    expect(validator.count('BLOCKER')).toBeGreaterThanOrEqual(1)
  })

  it('ForeignKey 自引用时生成 INFO', () => {
    const plan = buildSavePlan([], { projectName: 'Test', projectPath: '/tmp/test' })
    plan.constraints.set('c-fk', {
      version: 2,
      id: 'c-fk',
      type: 'ForeignKey',
      enabled: true,
      refs: {
        from_table_id: 'sc_users',
        from_column_id: 'col-email',
        to_table_id: 'sc_users',
        to_column_id: 'col-email',
      },
      params: {},
    } as any)

    const validator = new PreValidator(plan, [])
    validator.validate()

    expect(validator.count('INFO')).toBeGreaterThan(0)
    expect(validator.hasBlocker()).toBe(false)
  })
})

// ============================================================================
// Save Orchestrator
// ============================================================================

describe('Persistence - SaveOrchestrator', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('未配置项目路径时返回 BLOCKER', async () => {
    const orchestrator = new SaveOrchestrator({
      nodes: { value: [] } as any,
      edges: { value: [] } as any,
      projectName: { value: 'Test' } as any,
      getEffectiveProjectConfigPath: () => undefined,
      updateNodeData: vi.fn(),
    })

    const result = await orchestrator.saveProject()
    expect(result.success).toBe(false)
    expect(result.errors?.[0].severity).toBe('BLOCKER')
  })

  it('成功保存时调用 API 并更新 saveState', async () => {
    const schema = makeSchemaNode()
    const nn = makeConstraintNode(
      'notNullConstraint',
      {
        configName: '非空',
        sourceRef: { nodeId: 'schema-1', columnId: 'col-email' },
      },
      'c-nn'
    )

    const nodes: CustomNode[] = [schema, nn]
    const updateNodeData = vi.fn()

    vi.spyOn(projectV2Api, 'putV2FullConfig').mockResolvedValue(undefined)
    vi.spyOn(projectV2Api, 'putV2ProjectView').mockResolvedValue(undefined)

    const orchestrator = new SaveOrchestrator({
      nodes: { value: nodes } as any,
      edges: { value: [] } as any,
      projectName: { value: 'Test' } as any,
      getEffectiveProjectConfigPath: () => '/tmp/test/project.precis.yaml',
      updateNodeData,
    })

    const result = await orchestrator.saveProject()
    expect(result.success).toBe(true)
    expect(projectV2Api.putV2FullConfig).toHaveBeenCalledTimes(1)
    expect(projectV2Api.putV2ProjectView).toHaveBeenCalledTimes(1)
    expect(updateNodeData).toHaveBeenCalledWith(
      'schema-1',
      expect.objectContaining({ saveState: 'saved' })
    )
    expect(updateNodeData).toHaveBeenCalledWith(
      'c-nn',
      expect.objectContaining({ saveState: 'saved' })
    )
  })

  it('API 异常时返回 BLOCKER', async () => {
    vi.spyOn(projectV2Api, 'putV2FullConfig').mockRejectedValue(new Error('network error'))

    const schema = makeSchemaNode()
    const orchestrator = new SaveOrchestrator({
      nodes: { value: [schema] } as any,
      edges: { value: [] } as any,
      projectName: { value: 'Test' } as any,
      getEffectiveProjectConfigPath: () => '/tmp/test/project.precis.yaml',
      updateNodeData: vi.fn(),
    })

    const result = await orchestrator.saveProject()
    expect(result.success).toBe(false)
    expect(result.errors?.[0].message).toContain('network error')
  })
})

// ============================================================================
// Pre-Validator AutoFix
// ============================================================================

describe('Persistence - Pre-Validator AutoFix', () => {
  it('列名重复时 autoFix 自动加后缀', () => {
    const schema = makeSchemaNode({
      data: {
        tableName: 'dup',
        columns: [
          { id: 'c1', columnName: 'email' },
          { id: 'c2', columnName: 'email' },
        ],
        sourceFilePath: '/data/dup.csv',
      } as any,
    })

    const plan = buildSavePlan([schema], { projectName: 'Test', projectPath: '/tmp/test' })
    const validator = new PreValidator(plan, [schema])
    validator.validate()

    expect(validator.hasBlocker()).toBe(true)

    const fixed = validator.applyAutoFixes()
    expect(fixed.length).toBeGreaterThan(0)
    expect(validator.hasBlocker()).toBe(false)

    // 验证列名已被修正
    const schemaFile = Array.from(plan.schemas.values())[0].schemaFile
    const names = schemaFile.columns!.map((c) => c.name)
    expect(new Set(names).size).toBe(names.length) // 无重复
  })

  it('列 ID 缺失时 autoFix 生成默认 ID', () => {
    const schema = makeSchemaNode({
      data: {
        tableName: 'no_id',
        columns: [{ id: '', columnName: 'status' }],
        sourceFilePath: '/data/no_id.csv',
      } as any,
    })

    const plan = buildSavePlan([schema], { projectName: 'Test', projectPath: '/tmp/test' })
    const validator = new PreValidator(plan, [schema])
    validator.validate()

    expect(validator.hasBlocker()).toBe(true)

    const fixed = validator.applyAutoFixes()
    expect(fixed.length).toBeGreaterThan(0)
    expect(validator.hasBlocker()).toBe(false)

    const schemaFile = Array.from(plan.schemas.values())[0].schemaFile
    expect(schemaFile.columns![0].id).toBeTruthy()
  })

  it('列类型缺失时 autoFix 默认 Str', () => {
    const schema = makeSchemaNode({
      data: {
        tableName: 'no_type',
        columns: [{ id: 'c1', columnName: 'x', dataType: '' }],
        sourceFilePath: '/data/no_type.csv',
      } as any,
    })

    const plan = buildSavePlan([schema], { projectName: 'Test', projectPath: '/tmp/test' })
    // buildSavePlan 中 builder 会把空 dataType 转成 'Str'，这里手动覆盖为空
    const schemaPlan = Array.from(plan.schemas.values())[0]
    schemaPlan.schemaFile.columns![0].type = ''

    const validator = new PreValidator(plan, [schema])
    validator.validate()

    expect(validator.count('WARNING')).toBeGreaterThan(0)

    const fixed = validator.applyAutoFixes()
    expect(fixed.length).toBeGreaterThan(0)

    expect(schemaPlan.schemaFile.columns![0].type).toBe('Str')
  })

  it('Range min > max 时 autoFix 自动交换', () => {
    const plan = buildSavePlan([], { projectName: 'Test', projectPath: '/tmp/test' })
    const rangeFile = {
      version: 2,
      id: 'c-range',
      type: 'Range',
      enabled: true,
      refs: { table_id: 'sc_users', column_id: 'col-age' },
      params: { min: 100, max: 0 },
    } as any
    plan.constraints.set('c-range', rangeFile)

    const validator = new PreValidator(plan, [])
    validator.validate()
    expect(validator.hasBlocker()).toBe(true)
    expect(validator.count('BLOCKER')).toBeGreaterThanOrEqual(1)

    // 直接检查 errors 中是否有 autoFix
    const errorsWithFix = validator['errors'].filter((e: any) => e.autoFix)
    expect(errorsWithFix.length).toBeGreaterThan(0)

    const fixed = validator.applyAutoFixes()
    expect(fixed.length).toBeGreaterThan(0)
    expect(validator.hasBlocker()).toBe(false)

    expect(rangeFile.params.min).toBe(0)
    expect(rangeFile.params.max).toBe(100)
  })

  it('autoFix 关闭时不执行修复', () => {
    const schema = makeSchemaNode({
      data: {
        tableName: 'dup',
        columns: [
          { id: 'c1', columnName: 'email' },
          { id: 'c2', columnName: 'email' },
        ],
        sourceFilePath: '/data/dup.csv',
      } as any,
    })

    const plan = buildSavePlan([schema], { projectName: 'Test', projectPath: '/tmp/test' })
    const validator = new PreValidator(plan, [schema], { autoFix: false })
    validator.validate()

    expect(validator.hasBlocker()).toBe(true)

    const fixed = validator.applyAutoFixes()
    expect(fixed).toHaveLength(0)
    expect(validator.hasBlocker()).toBe(true) // 仍然阻断
  })

  it('SaveOrchestrator 保存时自动应用 autoFix', async () => {
    const schema = makeSchemaNode({
      data: {
        tableName: 'dup',
        columns: [
          { id: 'c1', columnName: 'email' },
          { id: 'c2', columnName: 'email' },
        ],
        sourceFilePath: '/data/dup.csv',
      } as any,
    })

    vi.spyOn(projectV2Api, 'putV2FullConfig').mockResolvedValue(undefined)
    vi.spyOn(projectV2Api, 'putV2ProjectView').mockResolvedValue(undefined)

    const orchestrator = new SaveOrchestrator({
      nodes: { value: [schema] } as any,
      edges: { value: [] } as any,
      projectName: { value: 'Test' } as any,
      getEffectiveProjectConfigPath: () => '/tmp/test/project.precis.yaml',
      updateNodeData: vi.fn(),
    })

    const result = await orchestrator.saveProject()
    expect(result.success).toBe(true)
    expect(result.fixed).toBeDefined()
    expect(result.fixed!.length).toBeGreaterThan(0)
  })
})
