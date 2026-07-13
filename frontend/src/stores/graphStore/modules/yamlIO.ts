/**
 * @file yamlIO.ts
 * @description YAML 导入导出模块 - 处理项目配置的序列化和反序列化
 *
 * ====================================================================
 * 功能概述
 * ====================================================================
 * 1. buildProjectYAML: 将画布数据构建为 YAML 格式字符串
 * 2. exportProjectAsFile: 导出项目为 YAML 文件
 * 3. exportSchemaAsYAML: 导出单个 Schema 为 YAML 格式
 * 4. importSchemaFromYAML: 从 YAML 导入 Schema 节点
 *
 * ====================================================================
 * buildProjectYAML 序列化流程
 * ====================================================================
 * 1. 收集所有 Schema 节点
 * 2. 收集所有 Constraint 节点
 * 3. 遍历 Schema 节点，序列化表名、列定义、约束
 * 4. 遍历 Constraint 节点，按类型序列化配置
 * 5. 收集 Assets 节点（如有）
 * 6. 组装为格式化的 YAML 字符串
 *
 * ====================================================================
 * 约束序列化处理
 * ====================================================================
 * 每种约束类型有不同的序列化逻辑：
 * - ForeignKey: sourceTable, sourceColumn, targetTable, targetColumn
 * - Unique: table, column
 * - NotNull: table, column
 * - AllowedValues: table, column, allowedValues 数组
 * - Conditional: table, ifColumn, ifValue, ifConditions, thenColumn
 * - Scripted: table, script
 * - Range: table, column, minValue, maxValue, boundaryMode
 * - Charset: table, column, charsetMode
 * - DateLogic: table, column, logicMode, compareOp 等
 *
 * ====================================================================
 * 序列化数据结构
 * ====================================================================
 * 【Schema 节点】
 * - tableName: 表名
 * - sheetName: Excel 工作表名
 * - columns: 列定义数组
 *   - columnName: 列名
 *   - dataType: 数据类型
 *   - validationErrors: 验证错误
 *   - constraints: 约束标记（notNull/unique）
 *
 * 【Constraint 节点】
 * - type: 约束类型
 * - configName: 配置名称
 * - sourceRef/targetRef: 节点引用
 * - 类型特定的配置字段
 *
 * ====================================================================
 * 导出功能
 * ====================================================================
 * 【exportProjectAsFile】
 * - 生成 YAML 内容
 * - 创建 Blob 对象（text/yaml;charset=utf-8）
 * - 生成下载链接
 * - 自动下载，文件名格式：{projectName}_{date}.yaml
 *
 * 【exportSchemaAsYAML】
 * - 查找指定的 Schema 节点
 * - 生成简化的 YAML 内容（不含约束）
 * - 返回 YAML 字符串供调用方使用
 *
 * ====================================================================
 * 导入功能
 * ====================================================================
 * 【importSchemaFromYAML】
 * - 解析 YAML 内容
 * - 提取 tableName, sheetName
 * - 解析 columns 数组
 * - 创建新的 Schema 节点
 * - 自动设置节点位置
 * - 返回新节点 ID
 *
 * ====================================================================
 * 错误处理
 * ====================================================================
 * - 导出失败显示 toast 错误
 * - 导入失败抛出异常
 * - 无效的 YAML 格式显示特定错误消息
 *
 * ====================================================================
 * 注意事项
 * ====================================================================
 * - 导出的 YAML 是简化格式，不完全等同于 V2 配置
 * - V2 配置通过 V2Persistence 模块处理
 * - 此模块主要用于兼容性和迁移场景
 *
 * ====================================================================
 * 依赖说明
 * ====================================================================
 * - 依赖 validationRegistry 获取约束类型信息
 * - 依赖 i18n 获取本地化的注释
 *
 * @module graphStore/modules
 */

import { logger } from '@/core/utils/logger'
import { nextTick, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { v4 as uuidv4 } from 'uuid'
import yaml from 'js-yaml'
import type {
  AllowedValuesConstraintNodeData,
  CharsetConstraintNodeData,
  ConditionalConstraintNodeData,
  CustomNode,
  DataType,
  DateLogicConstraintNodeData,
  ForeignKeyConstraintNodeData,
  NotNullConstraintNodeData,
  RangeConstraintNodeData,
  SchemaNodeData,
  ScriptedConstraintNodeData,
  TableAsset,
  UniqueConstraintNodeData,
} from '@/types/graph'
import type { CompositeConstraintNodeData } from '@/types/constraints'
import type { SchemaColumn } from '@/types/nodes'
import { toastError, toastSuccess } from '@/core/toast'
import {
  getConstraintKindByNodeType,
  isConstraintNodeType,
} from '@/services/constraints/validationRegistry'
import { addNodes } from '@/services/canvas/vueFlowApi'

export function createYamlIOModule(params: {
  nodes: Ref<CustomNode[]>
  assets: Ref<TableAsset[]>
  projectName: Ref<string>
  selectedNodeId: Ref<string | null>
}) {
  const { nodes, assets, projectName, selectedNodeId } = params
  const { t } = useI18n()

  /**
   * 构建约束节点序列化为对象（供 yaml.dump 使用）。
   * 字段统一 snake_case，与后端 V2 格式对齐。
   * 仅返回有值字段，避免输出 undefined。
   */
  function buildConstraintObject(
    node: CustomNode,
    constraintNodes: CustomNode[]
  ): Record<string, unknown> {
    const constraintType = getConstraintKindByNodeType(node.type) || 'scripted'
    const obj: Record<string, unknown> = { type: constraintType }

    switch (constraintType) {
      case 'foreignKey': {
        const d = node.data as ForeignKeyConstraintNodeData
        obj.config_name = d.configName || 'unnamed'
        obj.source_table = d.sourceTable
        obj.source_column = d.sourceColumn
        obj.target_table = d.targetTable
        obj.target_column = d.targetColumn
        if (d.constraintName) obj.constraint_name = d.constraintName
        if (d.allowNull !== undefined) obj.allow_null = d.allowNull
        if (d.advancedFilter) obj.advanced_filter = d.advancedFilter
        if (d.config?.ruleType) obj.rule_type = d.config.ruleType
        if (d.sourceRef)
          obj.source_ref = { node_id: d.sourceRef.nodeId, column_id: d.sourceRef.columnId }
        if (d.targetRef) {
          const targetRef: Record<string, unknown> = { node_id: d.targetRef.nodeId }
          if (d.targetRef.columnId) targetRef.column_id = d.targetRef.columnId
          obj.target_ref = targetRef
        }
        if (d.config?.targetNodeId) obj.target_node_id = d.config.targetNodeId
        if (d.config?.targetColumn) obj.target_column_name = d.config.targetColumn
        break
      }
      case 'unique': {
        const d = node.data as UniqueConstraintNodeData
        obj.config_name = d.configName || 'unnamed'
        obj.table = d.table
        obj.column = d.column
        if (d.constraintName) obj.constraint_name = d.constraintName
        break
      }
      case 'notNull': {
        const d = node.data as NotNullConstraintNodeData
        obj.config_name = d.configName || 'unnamed'
        obj.table = d.table
        obj.column = d.column
        if (d.constraintName) obj.constraint_name = d.constraintName
        break
      }
      case 'allowedValues': {
        const d = node.data as AllowedValuesConstraintNodeData
        obj.config_name = d.configName || 'unnamed'
        obj.table = d.table
        obj.column = d.column
        obj.allowed_values = Array.isArray(d.allowedValues)
          ? (d.allowedValues as string[])
          : Array.from((d.allowedValues as Set<string> | undefined) || [])
        if (d.sourceRef)
          obj.source_ref = { node_id: d.sourceRef.nodeId, column_id: d.sourceRef.columnId }
        if (d.constraintName) obj.constraint_name = d.constraintName
        break
      }
      case 'conditional': {
        const d = node.data as ConditionalConstraintNodeData
        obj.config_name = d.configName || 'unnamed'
        obj.table = d.table
        obj.if_column = d.ifColumn
        obj.if_value = d.ifValue
        if (d.ifLogic) obj.if_logic = d.ifLogic
        if (d.ifConditions && d.ifConditions.length > 0) {
          obj.if_conditions = d.ifConditions.map((cond) => {
            const c: Record<string, unknown> = { operator: cond.operator }
            if (cond.column) c.column = cond.column
            if (cond.value !== undefined) c.value = cond.value
            if (cond.values) c.values = cond.values
            if (cond.ref) c.ref = { node_id: cond.ref.nodeId, column_id: cond.ref.columnId }
            return c
          })
        }
        obj.then_column = d.thenColumn
        obj.then_condition = d.thenConditionConfig
        if (d.ifRef) obj.if_ref = { node_id: d.ifRef.nodeId, column_id: d.ifRef.columnId }
        if (d.thenRef) obj.then_ref = { node_id: d.thenRef.nodeId, column_id: d.thenRef.columnId }
        if (d.constraintName) obj.constraint_name = d.constraintName
        break
      }
      case 'scripted': {
        const d = node.data as ScriptedConstraintNodeData
        obj.config_name = d.configName || 'unnamed'
        obj.table = d.table
        obj.script = d.script
        if (d.constraintName) obj.constraint_name = d.constraintName
        break
      }
      case 'range': {
        const d = node.data as RangeConstraintNodeData
        obj.config_name = d.configName || 'unnamed'
        obj.table = d.table
        obj.column = d.column
        if (d.minValue !== undefined) obj.min_value = d.minValue
        if (d.maxValue !== undefined) obj.max_value = d.maxValue
        if (d.boundaryMode) obj.boundary_mode = d.boundaryMode
        if (d.sourceRef)
          obj.source_ref = { node_id: d.sourceRef.nodeId, column_id: d.sourceRef.columnId }
        if (d.constraintName) obj.constraint_name = d.constraintName
        break
      }
      case 'charset': {
        const d = node.data as CharsetConstraintNodeData
        obj.config_name = d.configName || 'unnamed'
        obj.table = d.table
        obj.column = d.column
        if (d.charsetMode) obj.charset_mode = d.charsetMode
        if (d.sourceRef)
          obj.source_ref = { node_id: d.sourceRef.nodeId, column_id: d.sourceRef.columnId }
        if (d.constraintName) obj.constraint_name = d.constraintName
        break
      }
      case 'dateLogic': {
        const d = node.data as DateLogicConstraintNodeData
        obj.config_name = d.configName || 'unnamed'
        obj.table = d.table
        obj.column = d.column
        if (d.logicMode) obj.logic_mode = d.logicMode
        if (d.compareOp) obj.compare_op = d.compareOp
        if (d.referenceDate) obj.reference_date = d.referenceDate
        if (d.referenceColumn) obj.reference_column = d.referenceColumn
        if (d.calculationType) obj.calculation_type = d.calculationType
        if (d.targetValue) obj.target_value = d.targetValue
        if (d.targetColumn) obj.target_column = d.targetColumn
        if (d.sourceRef)
          obj.source_ref = { node_id: d.sourceRef.nodeId, column_id: d.sourceRef.columnId }
        if (d.constraintName) obj.constraint_name = d.constraintName
        break
      }
      case 'composite': {
        const d = node.data as CompositeConstraintNodeData
        const extra = node.data as unknown as Record<string, unknown>
        obj.config_name = d.configName || 'unnamed'
        if (extra.table) obj.table = extra.table
        obj.logic = d.logic || 'all'
        const subNodeIds = d.includedNodeIds || []
        if (subNodeIds.length > 0) {
          obj.sub_constraints = subNodeIds.map((subId) => {
            const subNode = constraintNodes.find((n) => n.id === subId)
            const subType = subNode
              ? getConstraintKindByNodeType(subNode.type) || 'scripted'
              : 'scripted'
            return { id: subId, type: subType }
          })
        }
        if (d.constraintName) obj.constraint_name = d.constraintName
        break
      }
    }
    return obj
  }

  /**
   * 构建项目配置为完整 YAML 字符串。
   *
   * 采用"分块 dump + 注释拼接"策略：对 schemas/constraints/assets 各自构造对象树，
   * 用 js-yaml dump 序列化（正确处理转义），再在区块前插入 i18n 注释行。
   * 字段统一 snake_case，与后端 V2 格式对齐。
   */
  function buildProjectYAML(): string {
    const schemaNodes = nodes.value.filter((n) => n.type === 'schema')
    const constraintNodes = nodes.value.filter((n) => {
      if (!n.type) return false
      return isConstraintNodeType(n.type)
    })

    // 头部：项目名 + 生成时间（直接拼接，简单标量无需 dump）
    let result = t('messages.persistence.comments.projectConfig')
    result += `project_name: ${projectName.value || 'untitled_project'}\n`
    result += `generated_at: ${new Date().toISOString()}\n`

    // schemas 区块
    if (schemaNodes.length > 0) {
      const schemasObj: Record<string, unknown> = {}
      schemaNodes.forEach((node) => {
        const d = node.data as SchemaNodeData
        const columns = d.columns.map((col) => {
          const c: Record<string, unknown> = {
            column_name: col.columnName,
            data_type: col.dataType,
          }
          if ((col.validationErrors ?? []).length > 0) {
            c.validation_errors = col.validationErrors
          }
          if (col.constraints && (col.constraints.notNull || col.constraints.unique)) {
            const constraints: Record<string, unknown> = {}
            if (col.constraints.notNull) constraints.not_null = true
            if (col.constraints.unique) constraints.unique = true
            c.constraints = constraints
          }
          return c
        })
        const schemaObj: Record<string, unknown> = {
          table_name: d.tableName,
          columns,
        }
        if (d.sheetName) schemaObj.sheet_name = d.sheetName
        schemasObj[d.tableName] = schemaObj
      })
      result += '\n' + t('messages.persistence.comments.schemaConfig')
      result += yaml.dump({ schemas: schemasObj }, { indent: 2, lineWidth: 120 })
    }

    // constraints 区块
    if (constraintNodes.length > 0) {
      const constraintsObj: Record<string, unknown> = {}
      constraintNodes.forEach((node, index) => {
        const constraintType = getConstraintKindByNodeType(node.type) || 'scripted'
        constraintsObj[`${constraintType}_${index + 1}`] = buildConstraintObject(
          node,
          constraintNodes
        )
      })
      result += '\n' + t('messages.persistence.comments.constraintConfig')
      result += yaml.dump({ constraints: constraintsObj }, { indent: 2, lineWidth: 120 })
    }

    // assets 区块
    if (assets.value.length > 0) {
      const assetsObj: Record<string, unknown> = {}
      assets.value.forEach((asset) => {
        assetsObj[asset.configName] = {
          table_name: asset.tableName,
          ...(asset.sheetName ? { sheet_name: asset.sheetName } : {}),
          columns: asset.columns.map((col) => ({
            column_name: col.columnName,
            data_type: col.dataType,
          })),
        }
      })
      result += '\n' + t('messages.persistence.comments.assetsConfig')
      result += yaml.dump({ assets: assetsObj }, { indent: 2, lineWidth: 120 })
    }

    return result
  }

  function exportProjectAsFile(): void {
    try {
      const yamlContent = buildProjectYAML()
      const blob = new Blob([yamlContent], { type: 'text/yaml;charset=utf-8' })
      const url = URL.createObjectURL(blob)

      const link = document.createElement('a')
      link.href = url
      link.download = `${projectName.value || 'project'}_${new Date().toISOString().split('T')[0]}.yaml`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)

      URL.revokeObjectURL(url)

      toastSuccess(
        t('messages.persistence.exportYamlSuccess'),
        t('messages.persistence.exportSuccess')
      )
    } catch (error) {
      logger.error('导出项目失败:', error)
      toastError(t('messages.persistence.exportYamlFailed'), t('messages.persistence.saveFailed'))
    }
  }

  function exportSchemaAsYAML(nodeId: string): string {
    const node = nodes.value.find((n) => n.id === nodeId && n.type === 'schema')
    if (!node) throw new Error(t('messages.persistence.schemaNotFound'))

    const d = node.data as SchemaNodeData
    const schemaObj: Record<string, unknown> = {
      table_name: d.tableName,
      columns: d.columns.map((col) => ({
        column_name: col.columnName,
        data_type: col.dataType,
      })),
    }
    if (d.sheetName) schemaObj.sheet_name = d.sheetName

    // 头部注释 + dump（importSchemaFromYAML 支持这种单层格式）
    let result = `# Schema配置: ${d.configName}\n`
    result += yaml.dump(schemaObj, { indent: 2, lineWidth: 120 })
    return result
  }

  async function importSchemaFromYAML(
    yamlContent: string,
    position: { x: number; y: number }
  ): Promise<string> {
    try {
      const parsed = yaml.load(yamlContent) as Record<string, unknown> | null
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('Invalid YAML format')
      }

      // 支持两种格式：
      // 1. exportSchemaAsYAML 生成的单层格式: { table_name, sheet_name, columns }
      // 2. buildProjectYAML 生成的嵌套格式: { schemas: { tableName: { table_name, ... } } }
      let rawSchema: Record<string, unknown>
      if ('schemas' in parsed && parsed.schemas && typeof parsed.schemas === 'object') {
        const schemas = parsed.schemas as Record<string, unknown>
        const firstKey = Object.keys(schemas)[0]
        if (!firstKey) throw new Error('No schema found in YAML')
        rawSchema = schemas[firstKey] as Record<string, unknown>
      } else {
        rawSchema = parsed
      }

      const tableName = String(rawSchema.table_name || rawSchema.tableName || 'imported_table')
      const sheetName = (rawSchema.sheet_name || rawSchema.sheetName || undefined) as
        | string
        | undefined

      const rawColumns = Array.isArray(rawSchema.columns) ? rawSchema.columns : []
      const columns: SchemaColumn[] = rawColumns.map((col: unknown) => {
        const c = col as Record<string, unknown>
        const columnName = String(c.column_name || c.columnName || '')
        const dataType = String(c.data_type || c.dataType || 'String') as DataType
        const constraints = c.constraints as Record<string, unknown> | undefined
        const allowedValues = c.allowed_values || c.allowedValues

        return {
          id: uuidv4(),
          columnName,
          dataType,
          validationErrors: Array.isArray(c.validation_errors || c.validationErrors)
            ? ((c.validation_errors || c.validationErrors) as string[])
            : [],
          constraints: constraints
            ? {
                notNull: !!constraints.notNull,
                unique: !!constraints.unique,
                allowedValues: Array.isArray(allowedValues)
                  ? (allowedValues as string[])
                  : undefined,
              }
            : undefined,
        }
      })

      const newNode: CustomNode = {
        id: uuidv4(),
        type: 'schema',
        position,
        data: {
          configName: `导入的Schema_${Date.now()}`,
          tableName,
          sheetName,
          columns,
          saveState: 'draft',
        } as SchemaNodeData,
      }

      addNodes(newNode)
      // addNodes 是 Vue Flow 增量 API，必须等待 nextTick 让内部状态与 store 同步后
      // 再设置选中节点，否则外部通过 selectedNodeId 查找节点时可能还不可见。
      await nextTick()
      selectedNodeId.value = newNode.id

      return newNode.id
    } catch (error) {
      logger.error('Schema导入失败:', error)
      throw new Error(t('messages.persistence.invalidYamlFormat'))
    }
  }

  return {
    buildProjectYAML,
    exportProjectAsFile,
    exportSchemaAsYAML,
    importSchemaFromYAML,
  }
}
