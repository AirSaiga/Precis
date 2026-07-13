/**
 * @fileoverview constraintFactory 工厂模块单元测试
 *
 * 覆盖 createConstraintFactoryModule 的三个导出：
 * - getConstraintTypeName: 约束类型的 i18n 显示名
 * - getDefaultConstraintData: 各约束类型的默认数据
 * - createConstraintNode: 10 种约束类型的节点创建（验证默认 data 与类型映射）
 *
 * 测试策略（遵循 AGENTS.md 工厂模块测试规范）：
 * - mock 外部边界：vueFlowApi（addNodes/findNode）、i18n
 * - 注入真实最小依赖：nodes/selectedNodeId ref
 * - 验证最终状态（createNode 被调用 + data 正确），不断言内部细节
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import type { CustomNode } from '@/types/graph'

// mock vueFlowApi（外部边界）
vi.mock('@/services/canvas/vueFlowApi', () => ({
  addNodes: vi.fn(),
  findNode: vi.fn(() => undefined),
}))

// mock animationDurations（createBaseNodeFactory 依赖）
vi.mock('@/services/canvas/animationDurations', () => ({
  NODE_ENTER_DURATION_MS: 300,
  NODE_ENTERING_CLASS: 'node-entering',
}))

// mock i18n：返回可识别的 key 映射，便于断言
vi.mock('@/i18n', () => ({
  default: {
    global: {
      t: (key: string, params?: Record<string, unknown>) => {
        const map: Record<string, string> = {
          'factories.foreignKey': '外键约束',
          'factories.unique': '唯一约束',
          'factories.notNull': '非空约束',
          'factories.allowedValues': '允许值约束',
          'factories.conditional': '条件约束',
          'factories.scripted': '脚本约束',
          'factories.range': '范围约束',
          'factories.charset': '字符集约束',
          'factories.dateLogic': '日期逻辑约束',
          'factories.composite': '复合约束',
          'factories.unknown': '未知约束',
          'factories.newConstraint': `新建${(params as Record<string, unknown>)?.type || ''}`,
        }
        return map[key] || key
      },
    },
  },
}))

import { createConstraintFactoryModule } from '@/stores/graphStore/modules/factories/constraintFactory'
import { addNodes } from '@/services/canvas/vueFlowApi'

describe('createConstraintFactoryModule', () => {
  let nodes: ReturnType<typeof ref<CustomNode[]>>
  let selectedNodeId: ReturnType<typeof ref<string | null>>
  let module: ReturnType<typeof createConstraintFactoryModule>

  beforeEach(() => {
    nodes = ref<CustomNode[]>([])
    selectedNodeId = ref<string | null>(null)
    module = createConstraintFactoryModule({ nodes, selectedNodeId })
    vi.mocked(addNodes).mockClear()
  })

  describe('getConstraintTypeName', () => {
    it('返回各约束类型的显示名', () => {
      expect(module.getConstraintTypeName('foreignKey')).toBe('外键约束')
      expect(module.getConstraintTypeName('unique')).toBe('唯一约束')
      expect(module.getConstraintTypeName('notNull')).toBe('非空约束')
      expect(module.getConstraintTypeName('allowedValues')).toBe('允许值约束')
      expect(module.getConstraintTypeName('conditional')).toBe('条件约束')
      expect(module.getConstraintTypeName('scripted')).toBe('脚本约束')
      expect(module.getConstraintTypeName('range')).toBe('范围约束')
      expect(module.getConstraintTypeName('charset')).toBe('字符集约束')
      expect(module.getConstraintTypeName('dateLogic')).toBe('日期逻辑约束')
      expect(module.getConstraintTypeName('composite')).toBe('复合约束')
    })

    it('未知类型回退到 unknown', () => {
      expect(module.getConstraintTypeName('nonexistent')).toBe('未知约束')
    })
  })

  describe('getDefaultConstraintData', () => {
    it('foreignKey 默认数据含 source/target 表和列', () => {
      const data = module.getDefaultConstraintData('foreignKey')
      expect(data).toHaveProperty('sourceTable', 'source_table')
      expect(data).toHaveProperty('sourceColumn', 'source_column')
      expect(data).toHaveProperty('targetTable', 'target_table')
    })

    it('unique 默认数据含 table 和 columns 数组', () => {
      const data = module.getDefaultConstraintData('unique')
      expect(data).toHaveProperty('table', 'table_name')
      expect(Array.isArray(data.columns)).toBe(true)
    })

    it('range 默认数据含 min/max/boundary', () => {
      const data = module.getDefaultConstraintData('range')
      expect(data).toHaveProperty('minValue', 0)
      expect(data).toHaveProperty('maxValue', 100)
      expect(data).toHaveProperty('boundaryMode', 'inclusive')
    })

    it('composite 默认数据含 logic 和空 subGraph', () => {
      const data = module.getDefaultConstraintData('composite')
      expect(data).toHaveProperty('logic', 'all')
      expect(data).toHaveProperty('subGraph')
      const sg = data.subGraph as { nodes: unknown[]; edges: unknown[] }
      expect(sg.nodes).toHaveLength(0)
      expect(sg.edges).toHaveLength(0)
    })

    it('未知类型返回空对象', () => {
      expect(module.getDefaultConstraintData('nonexistent')).toEqual({})
    })
  })

  describe('createConstraintNode', () => {
    it('创建 notNull 节点并调用 addNodes', () => {
      const id = module.createConstraintNode({ x: 10, y: 20 }, 'notNull')
      expect(typeof id).toBe('string')
      expect(addNodes).toHaveBeenCalledTimes(1)
      // createBaseNodeFactory 默认 autoSelect=true，应设置选中
      expect(selectedNodeId.value).toBe(id)
    })

    it('notNull 默认 data 含 table/column/configName', () => {
      module.createConstraintNode({ x: 0, y: 0 }, 'notNull')
      const call = vi.mocked(addNodes).mock.calls[0][0] as CustomNode
      expect(call.type).toBe('notNullConstraint')
      const data = call.data as Record<string, unknown>
      expect(data.table).toBe('table_name')
      expect(data.column).toBe('column_name')
      expect(data.configName).toContain('新建')
    })

    it('foreignKey data 含 source/target 表列', () => {
      module.createConstraintNode({ x: 0, y: 0 }, 'foreignKey')
      const call = vi.mocked(addNodes).mock.calls[0][0] as CustomNode
      expect(call.type).toBe('foreignKeyConstraint')
      const data = call.data as Record<string, unknown>
      expect(data.sourceTable).toBe('source_table')
      expect(data.targetTable).toBe('target_table')
    })

    it('range data 含 min/max/boundary', () => {
      module.createConstraintNode({ x: 0, y: 0 }, 'range')
      const call = vi.mocked(addNodes).mock.calls[0][0] as CustomNode
      const data = call.data as Record<string, unknown>
      expect(data.minValue).toBe(0)
      expect(data.maxValue).toBe(100)
      expect(data.boundaryMode).toBe('inclusive')
    })

    it('composite data 含 logic/subGraph', () => {
      module.createConstraintNode({ x: 0, y: 0 }, 'composite')
      const call = vi.mocked(addNodes).mock.calls[0][0] as CustomNode
      const data = call.data as Record<string, unknown>
      expect(data.logic).toBe('all')
      expect((data.subGraph as { nodes: unknown[] }).nodes).toHaveLength(0)
    })

    it('allowedValues 默认 allowedValues 是 Set', () => {
      module.createConstraintNode({ x: 0, y: 0 }, 'allowedValues')
      const call = vi.mocked(addNodes).mock.calls[0][0] as CustomNode
      const data = call.data as Record<string, unknown>
      expect(data.allowedValues).toBeInstanceOf(Set)
    })

    it('自定义 data 覆盖默认值', () => {
      module.createConstraintNode({ x: 0, y: 0 }, 'notNull', {
        table: 'custom_table',
        column: 'custom_col',
      })
      const call = vi.mocked(addNodes).mock.calls[0][0] as CustomNode
      const data = call.data as Record<string, unknown>
      expect(data.table).toBe('custom_table')
      expect(data.column).toBe('custom_col')
    })

    it('charset 默认 charsetMode 为 ascii', () => {
      module.createConstraintNode({ x: 0, y: 0 }, 'charset')
      const call = vi.mocked(addNodes).mock.calls[0][0] as CustomNode
      const data = call.data as Record<string, unknown>
      expect(data.charsetMode).toBe('ascii')
    })

    it('dateLogic 默认 logicMode/compareOp/calculationType', () => {
      module.createConstraintNode({ x: 0, y: 0 }, 'dateLogic')
      const call = vi.mocked(addNodes).mock.calls[0][0] as CustomNode
      const data = call.data as Record<string, unknown>
      expect(data.logicMode).toBe('compare')
      expect(data.compareOp).toBe('gt')
      expect(data.calculationType).toBe('age')
    })

    it('未知约束类型抛出错误', () => {
      expect(() => module.createConstraintNode({ x: 0, y: 0 }, 'nonexistent' as never)).toThrow()
    })
  })
})
