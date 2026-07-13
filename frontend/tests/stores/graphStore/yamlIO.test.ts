import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref } from 'vue'
import yaml from 'js-yaml'
import type { CustomNode } from '@/types/graph'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'messages.persistence.comments.projectConfig': '# Project Config\n',
        'messages.persistence.comments.schemaConfig': '# Schema Config\n',
        'messages.persistence.comments.constraintConfig': '# Constraint Config\n',
        'messages.persistence.comments.assetsConfig': '# Assets Config\n',
        'messages.persistence.exportYamlSuccess': 'Export success',
        'messages.persistence.exportSuccess': 'Success',
        'messages.persistence.exportYamlFailed': 'Export failed',
        'messages.persistence.saveFailed': 'Save failed',
        'messages.persistence.schemaNotFound': 'Schema not found',
        'messages.persistence.invalidYamlFormat': 'Invalid YAML format',
      }
      return map[key] || key
    },
  }),
}))

vi.mock('@/services/canvas/vueFlowApi', () => ({
  addNodes: vi.fn(),
}))

vi.mock('@/services/constraints/validationRegistry', () => ({
  getConstraintKindByNodeType: vi.fn((type: string) => {
    const map: Record<string, string> = {
      notNullConstraint: 'notNull',
      uniqueConstraint: 'unique',
      foreignKeyConstraint: 'foreignKey',
      allowedValuesConstraint: 'allowedValues',
      conditionalConstraint: 'conditional',
      scriptedConstraint: 'scripted',
      rangeConstraint: 'range',
      charsetConstraint: 'charset',
      dateLogicConstraint: 'dateLogic',
      compositeConstraint: 'composite',
    }
    return map[type] || ''
  }),
  isConstraintNodeType: vi.fn((type: string) => {
    return [
      'notNullConstraint',
      'uniqueConstraint',
      'foreignKeyConstraint',
      'allowedValuesConstraint',
      'conditionalConstraint',
      'scriptedConstraint',
      'rangeConstraint',
      'charsetConstraint',
      'dateLogicConstraint',
      'compositeConstraint',
    ].includes(type)
  }),
}))

vi.mock('@/core/utils/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock('@/core/toast', () => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

import { createYamlIOModule } from '@/stores/graphStore/modules/yamlIO'
import { addNodes } from '@/services/canvas/vueFlowApi'
import { toastSuccess, toastError } from '@/core/toast'

function makeSchemaNode(overrides: Partial<CustomNode> = {}): CustomNode {
  return {
    id: 'schema-1',
    type: 'schema',
    position: { x: 0, y: 0 },
    data: {
      configName: 'Users',
      tableName: 'users',
      sheetName: 'Sheet1',
      columns: [
        {
          id: 'c1',
          columnName: 'email',
          dataType: 'String',
          validationErrors: [],
          constraints: { notNull: true },
        },
        { id: 'c2', columnName: 'age', dataType: 'Integer', validationErrors: [] },
      ],
      saveState: 'saved',
      ...((overrides.data || {}) as any),
    },
    ...overrides,
  } as CustomNode
}

function makeConstraintNode(type: string, data: Record<string, unknown>, id = 'c-1'): CustomNode {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data: {
      configName: 'Test Constraint',
      saveState: 'saved',
      ...data,
    } as any,
  } as CustomNode
}

describe('yamlIO module', () => {
  let nodes: ReturnType<typeof ref<CustomNode[]>>
  let assets: ReturnType<typeof ref<any[]>>
  let projectName: ReturnType<typeof ref<string>>
  let selectedNodeId: ReturnType<typeof ref<string | null>>
  let module: ReturnType<typeof createYamlIOModule>

  beforeEach(() => {
    nodes = ref<CustomNode[]>([])
    assets = ref<any[]>([])
    projectName = ref('TestProject')
    selectedNodeId = ref<string | null>(null)
    module = createYamlIOModule({ nodes, assets, projectName, selectedNodeId })
    vi.mocked(addNodes).mockClear()
    vi.mocked(toastSuccess).mockClear()
    vi.mocked(toastError).mockClear()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('buildProjectYAML', () => {
    it('空画布生成基础 YAML', () => {
      const yaml = module.buildProjectYAML()
      expect(yaml).toContain('project_name: TestProject')
      expect(yaml).toContain('generated_at:')
      expect(yaml).not.toContain('schemas:')
      expect(yaml).not.toContain('constraints:')
    })

    it('Schema 节点序列化正确', () => {
      nodes.value = [makeSchemaNode()]
      const yaml = module.buildProjectYAML()
      expect(yaml).toContain('schemas:')
      expect(yaml).toContain('table_name: users')
      expect(yaml).toContain('sheet_name: Sheet1')
      expect(yaml).toContain('column_name: email')
      expect(yaml).toContain('column_name: age')
      expect(yaml).toContain('data_type: String')
      expect(yaml).toContain('data_type: Integer')
      expect(yaml).toContain('not_null: true')
    })

    it('NotNull 约束序列化正确', () => {
      nodes.value = [
        makeConstraintNode('notNullConstraint', {
          table: 'users',
          column: 'email',
          constraintName: 'nn_email',
        }),
      ]
      const yaml = module.buildProjectYAML()
      expect(yaml).toContain('type: notNull')
      expect(yaml).toContain('table: users')
      expect(yaml).toContain('column: email')
      expect(yaml).toContain('constraint_name: nn_email')
    })

    it('Unique 约束序列化正确', () => {
      nodes.value = [makeConstraintNode('uniqueConstraint', { table: 'users', column: 'email' })]
      const yaml = module.buildProjectYAML()
      expect(yaml).toContain('type: unique')
      expect(yaml).toContain('table: users')
      expect(yaml).toContain('column: email')
    })

    it('ForeignKey 约束序列化正确', () => {
      nodes.value = [
        makeConstraintNode('foreignKeyConstraint', {
          sourceTable: 'orders',
          sourceColumn: 'user_id',
          targetTable: 'users',
          targetColumn: 'id',
          allowNull: false,
          sourceRef: { nodeId: 's1', columnId: 'c1' },
          targetRef: { nodeId: 's2', columnId: 'c2' },
          config: { ruleType: 'EXIST_IN', targetNodeId: 's2', targetColumn: 'id' },
        }),
      ]
      const yaml = module.buildProjectYAML()
      expect(yaml).toContain('type: foreignKey')
      expect(yaml).toContain('source_table: orders')
      expect(yaml).toContain('source_column: user_id')
      expect(yaml).toContain('target_table: users')
      expect(yaml).toContain('target_column: id')
      expect(yaml).toContain('allow_null: false')
      expect(yaml).toContain('rule_type: EXIST_IN')
      expect(yaml).toContain('target_node_id: s2')
      expect(yaml).toContain('target_column_name: id')
      expect(yaml).toContain('source_ref:')
      expect(yaml).toContain('target_ref:')
    })

    it('AllowedValues 约束序列化正确', () => {
      nodes.value = [
        makeConstraintNode('allowedValuesConstraint', {
          table: 'users',
          column: 'status',
          allowedValues: new Set(['active', 'inactive']),
          sourceRef: { nodeId: 's1', columnId: 'c1' },
        }),
      ]
      const yaml = module.buildProjectYAML()
      expect(yaml).toContain('type: allowedValues')
      expect(yaml).toContain('table: users')
      expect(yaml).toContain('column: status')
      expect(yaml).toContain('allowed_values:')
      expect(yaml).toContain('active')
      expect(yaml).toContain('inactive')
      expect(yaml).toContain('source_ref:')
    })

    it('Conditional 约束序列化正确', () => {
      nodes.value = [
        makeConstraintNode('conditionalConstraint', {
          table: 'users',
          ifColumn: 'status',
          ifValue: 'active',
          ifLogic: 'and',
          ifConditions: [{ operator: 'eq', column: 'status', value: 'active' }],
          thenColumn: 'email',
          thenConditionConfig: { type: 'notNull' },
          ifRef: { nodeId: 's1', columnId: 'c1' },
          thenRef: { nodeId: 's1', columnId: 'c2' },
        }),
      ]
      const yaml = module.buildProjectYAML()
      expect(yaml).toContain('type: conditional')
      expect(yaml).toContain('table: users')
      expect(yaml).toContain('if_column: status')
      expect(yaml).toContain('if_logic: and')
      expect(yaml).toContain('if_conditions:')
      expect(yaml).toContain('operator: eq')
      expect(yaml).toContain('then_column: email')
      expect(yaml).toContain('if_ref:')
      expect(yaml).toContain('then_ref:')
    })

    it('Scripted 约束序列化正确', () => {
      nodes.value = [
        makeConstraintNode('scriptedConstraint', {
          table: 'users',
          script: 'return value > 0',
        }),
      ]
      const yaml = module.buildProjectYAML()
      expect(yaml).toContain('type: scripted')
      expect(yaml).toContain('table: users')
      expect(yaml).toContain('script:')
    })

    it('Range 约束序列化正确', () => {
      nodes.value = [
        makeConstraintNode('rangeConstraint', {
          table: 'users',
          column: 'age',
          minValue: 0,
          maxValue: 150,
          boundaryMode: 'inclusive',
          sourceRef: { nodeId: 's1', columnId: 'c1' },
        }),
      ]
      const yaml = module.buildProjectYAML()
      expect(yaml).toContain('type: range')
      expect(yaml).toContain('table: users')
      expect(yaml).toContain('column: age')
      expect(yaml).toContain('min_value: 0')
      expect(yaml).toContain('max_value: 150')
      expect(yaml).toContain('boundary_mode: inclusive')
    })

    it('Charset 约束序列化正确', () => {
      nodes.value = [
        makeConstraintNode('charsetConstraint', {
          table: 'users',
          column: 'name',
          charsetMode: 'ascii',
          sourceRef: { nodeId: 's1', columnId: 'c1' },
        }),
      ]
      const yaml = module.buildProjectYAML()
      expect(yaml).toContain('type: charset')
      expect(yaml).toContain('table: users')
      expect(yaml).toContain('column: name')
      expect(yaml).toContain('charset_mode: ascii')
    })

    it('DateLogic 约束序列化正确', () => {
      nodes.value = [
        makeConstraintNode('dateLogicConstraint', {
          table: 'users',
          column: 'birthday',
          logicMode: 'compare',
          compareOp: 'gt',
          referenceDate: '2000-01-01',
          referenceColumn: 'created_at',
          calculationType: 'age',
          targetValue: '18',
          targetColumn: 'age',
          sourceRef: { nodeId: 's1', columnId: 'c1' },
        }),
      ]
      const yaml = module.buildProjectYAML()
      expect(yaml).toContain('type: dateLogic')
      expect(yaml).toContain('table: users')
      expect(yaml).toContain('column: birthday')
      expect(yaml).toContain('logic_mode: compare')
      expect(yaml).toContain('compare_op: gt')
      expect(yaml).toContain('reference_date:') // js-yaml 对日期格式字符串加引号: '2000-01-01'
      expect(yaml).toContain('2000-01-01')
      expect(yaml).toContain('reference_column: created_at')
      expect(yaml).toContain('calculation_type: age')
      expect(yaml).toContain('target_value:') // js-yaml 对纯数字字符串加引号: '18'
      expect(yaml).toContain('18')
      expect(yaml).toContain('target_column: age')
    })

    it('Composite 约束序列化正确', () => {
      nodes.value = [
        makeConstraintNode('compositeConstraint', {
          logic: 'all',
        }),
      ]
      const yaml = module.buildProjectYAML()
      expect(yaml).toContain('type: composite')
      expect(yaml).toContain('composite_1:')
    })

    it('Assets 序列化正确', () => {
      assets.value = [
        {
          id: 'a1',
          configName: 'Asset1',
          tableName: 'products',
          sheetName: 'Sheet1',
          columns: [
            { columnName: 'id', dataType: 'Integer' },
            { columnName: 'name', dataType: 'String' },
          ],
        },
      ]
      const yaml = module.buildProjectYAML()
      expect(yaml).toContain('assets:')
      expect(yaml).toContain('table_name: products')
      expect(yaml).toContain('column_name: id')
      expect(yaml).toContain('column_name: name')
    })

    it('特殊字符由 js-yaml dump 正确序列化', () => {
      nodes.value = [
        makeSchemaNode({
          data: {
            tableName: 'test:special',
            sheetName: 'Sheet1',
            columns: [{ id: 'c1', columnName: 'col"quote', dataType: 'String' }],
            saveState: 'saved',
          } as any,
        }),
      ]
      const yamlContent = module.buildProjectYAML()
      // 验证值完整保留在输出中
      expect(yamlContent).toContain('test:special')
      expect(yamlContent).toContain('col"quote')
      // 关键：dump 产出的 YAML 应能被 yaml.load 还原回相同结构（round-trip 安全）
      const restored = yaml.load(yamlContent) as Record<string, unknown>
      const schemas = restored.schemas as Record<string, unknown>
      const schema = schemas['test:special'] as Record<string, unknown>
      const columns = schema.columns as Array<Record<string, unknown>>
      expect(columns[0].column_name).toBe('col"quote')
    })
  })

  describe('exportProjectAsFile', () => {
    it('成功导出调用 toastSuccess', () => {
      const createObjectURL = vi.fn().mockReturnValue('blob:url')
      const revokeObjectURL = vi.fn()
      URL.createObjectURL = createObjectURL
      URL.revokeObjectURL = revokeObjectURL

      const appendChild = vi.fn()
      const removeChild = vi.fn()
      const click = vi.fn()
      document.body.appendChild = appendChild
      document.body.removeChild = removeChild

      const createElement = vi.spyOn(document, 'createElement').mockReturnValue({
        click,
      } as any)

      module.exportProjectAsFile()

      expect(createObjectURL).toHaveBeenCalledTimes(1)
      expect(appendChild).toHaveBeenCalledTimes(1)
      expect(click).toHaveBeenCalledTimes(1)
      expect(removeChild).toHaveBeenCalledTimes(1)
      expect(revokeObjectURL).toHaveBeenCalledTimes(1)
      expect(toastSuccess).toHaveBeenCalledTimes(1)

      createElement.mockRestore()
    })

    it('导出失败调用 toastError', () => {
      const createObjectURL = vi.fn().mockImplementation(() => {
        throw new Error('blob error')
      })
      URL.createObjectURL = createObjectURL

      module.exportProjectAsFile()
      expect(toastError).toHaveBeenCalledTimes(1)
    })
  })

  describe('exportSchemaAsYAML', () => {
    it('导出存在的 schema 节点', () => {
      nodes.value = [makeSchemaNode()]
      const yaml = module.exportSchemaAsYAML('schema-1')
      expect(yaml).toContain('table_name: users')
      expect(yaml).toContain('sheet_name: Sheet1')
      expect(yaml).toContain('columns:')
      expect(yaml).toContain('column_name: email')
    })

    it('不存在的节点抛出错误', () => {
      expect(() => module.exportSchemaAsYAML('nonexistent')).toThrow('Schema not found')
    })

    it('非 schema 类型节点抛出错误', () => {
      nodes.value = [makeConstraintNode('notNullConstraint', {})]
      expect(() => module.exportSchemaAsYAML('c-1')).toThrow('Schema not found')
    })
  })

  describe('importSchemaFromYAML', () => {
    beforeEach(() => {
      // 让 mock 的 addNodes 同时把节点写入本地 nodes，验证“导入后节点可查找”
      vi.mocked(addNodes).mockImplementation((node: any) => {
        nodes.value = [...nodes.value, node]
      })
    })

    it('从单层 YAML 导入 Schema', async () => {
      const yaml = `
table_name: imported_table
sheet_name: Sheet1
columns:
  - column_name: id
    data_type: Integer
  - column_name: name
    data_type: String
      `
      const id = await module.importSchemaFromYAML(yaml, { x: 100, y: 200 })
      expect(typeof id).toBe('string')
      expect(addNodes).toHaveBeenCalledTimes(1)
      const node = vi.mocked(addNodes).mock.calls[0][0] as CustomNode
      expect(node.type).toBe('schema')
      expect(node.data.tableName).toBe('imported_table')
      expect(node.data.columns).toHaveLength(2)
      expect(node.data.columns[0].columnName).toBe('id')
      expect(node.data.columns[0].dataType).toBe('Integer')
      expect(selectedNodeId.value).toBe(id)
    })

    it('从嵌套 YAML（schemas 格式）导入', async () => {
      const yaml = `
schemas:
  my_table:
    table_name: nested_table
    columns:
      - column_name: col1
        data_type: String
      `
      const id = await module.importSchemaFromYAML(yaml, { x: 0, y: 0 })
      expect(typeof id).toBe('string')
      const node = vi.mocked(addNodes).mock.calls[0][0] as CustomNode
      expect(node.data.tableName).toBe('nested_table')
      // 导入后节点应可在 store 中查找
      expect(nodes.value.find((n) => n.id === id)).toBeDefined()
    })

    it('空 schemas 对象抛出错误', async () => {
      const yaml = 'schemas: {}'
      await expect(module.importSchemaFromYAML(yaml, { x: 0, y: 0 })).rejects.toThrow()
    })

    it('无效 YAML 抛出错误', async () => {
      await expect(
        module.importSchemaFromYAML('not: valid: yaml: [', { x: 0, y: 0 })
      ).rejects.toThrow()
    })

    it('解析带 constraints 的列', async () => {
      const yaml = `
table_name: test
columns:
  - column_name: email
    data_type: String
    constraints:
      notNull: true
      unique: true
    allowed_values:
      - a@b.com
      - c@d.com
      `
      await module.importSchemaFromYAML(yaml, { x: 0, y: 0 })
      const node = vi.mocked(addNodes).mock.calls[0][0] as CustomNode
      const col = node.data.columns[0]
      expect(col.constraints.notNull).toBe(true)
      expect(col.constraints.unique).toBe(true)
      expect(col.constraints.allowedValues).toEqual(['a@b.com', 'c@d.com'])
    })

    it('默认数据类型为 String', async () => {
      const yaml = `
table_name: test
columns:
  - column_name: x
      `
      await module.importSchemaFromYAML(yaml, { x: 0, y: 0 })
      const node = vi.mocked(addNodes).mock.calls[0][0] as CustomNode
      expect(node.data.columns[0].dataType).toBe('String')
    })

    it('导入后节点可在 store 中查找', async () => {
      const yaml = `
table_name: findable
columns:
  - column_name: id
    data_type: Integer
      `
      const id = await module.importSchemaFromYAML(yaml, { x: 10, y: 20 })
      const found = nodes.value.find((n) => n.id === id)
      expect(found).toBeDefined()
      expect(found?.type).toBe('schema')
      expect(selectedNodeId.value).toBe(id)
    })
  })
})
