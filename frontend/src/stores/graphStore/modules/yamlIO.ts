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

  function yamlSafe(value: string | undefined | null): string {
    if (value === undefined || value === null) return ''
    if (/^[a-zA-Z0-9_\s./-]+$/.test(value)) return value
    return JSON.stringify(value)
  }

  function buildProjectYAML(): string {
    const schemaNodes = nodes.value.filter((n) => n.type === 'schema')
    const constraintNodes = nodes.value.filter((n) => {
      if (!n.type) return false
      return isConstraintNodeType(n.type)
    })

    let yaml = t('messages.persistence.comments.projectConfig')
    yaml += `project_name: ${yamlSafe(projectName.value) || 'untitled_project'}\n`
    yaml += `generated_at: ${new Date().toISOString()}\n\n`

    if (schemaNodes.length > 0) {
      yaml += t('messages.persistence.comments.schemaConfig')
      yaml += 'schemas:\n'

      schemaNodes.forEach((node, index) => {
        const schemaData = node.data as SchemaNodeData
        yaml += `  ${yamlSafe(schemaData.tableName)}:\n`
        yaml += `    table_name: ${yamlSafe(schemaData.tableName)}\n`
        yaml += `    sheet_name: ${yamlSafe(schemaData.sheetName)}\n`
        yaml += `    columns:\n`

        schemaData.columns.forEach((column) => {
          yaml += `      - column_name: ${yamlSafe(column.columnName)}\n`
          yaml += `        data_type: ${column.dataType}\n`
          if ((column.validationErrors ?? []).length > 0) {
            yaml += `        validation_errors: ${JSON.stringify(column.validationErrors)}\n`
          }
          if (column.constraints && (column.constraints.notNull || column.constraints.unique)) {
            yaml += `        constraints:\n`
            if (column.constraints.notNull) {
              yaml += `          notNull: true\n`
            }
            if (column.constraints.unique) {
              yaml += `          unique: true\n`
            }
          }
        })

        if (index < schemaNodes.length - 1) {
          yaml += '\n'
        }
      })
    }

    if (constraintNodes.length > 0) {
      yaml += '\n' + t('messages.persistence.comments.constraintConfig')
      yaml += 'constraints:\n'

      constraintNodes.forEach((node, index) => {
        const constraintType = getConstraintKindByNodeType(node.type) || 'scripted'

        yaml += `  ${constraintType}_${index + 1}:\n`
        yaml += `    type: ${constraintType}\n`

        switch (constraintType) {
          case 'foreignKey': {
            const foreignKeyData = node.data as ForeignKeyConstraintNodeData
            yaml += `    config_name: ${yamlSafe(foreignKeyData.configName || 'unnamed')}\n`
            yaml += `    source_table: ${yamlSafe(foreignKeyData.sourceTable)}\n`
            yaml += `    source_column: ${yamlSafe(foreignKeyData.sourceColumn)}\n`
            yaml += `    target_table: ${yamlSafe(foreignKeyData.targetTable)}\n`
            yaml += `    target_column: ${yamlSafe(foreignKeyData.targetColumn)}\n`
            if (foreignKeyData.constraintName)
              yaml += `    constraint_name: ${yamlSafe(foreignKeyData.constraintName)}\n`
            if (foreignKeyData.allowNull !== undefined)
              yaml += `    allow_null: ${foreignKeyData.allowNull}\n`
            if (foreignKeyData.advancedFilter)
              yaml += `    advanced_filter: ${JSON.stringify(foreignKeyData.advancedFilter)}\n`
            if (foreignKeyData.config?.ruleType)
              yaml += `    rule_type: ${foreignKeyData.config.ruleType}\n`
            if (foreignKeyData.sourceRef) {
              yaml += `    source_ref:\n`
              yaml += `      node_id: ${foreignKeyData.sourceRef.nodeId}\n`
              yaml += `      column_id: ${foreignKeyData.sourceRef.columnId}\n`
            }
            if (foreignKeyData.targetRef) {
              yaml += `    target_ref:\n`
              yaml += `      node_id: ${foreignKeyData.targetRef.nodeId}\n`
              if (foreignKeyData.targetRef.columnId)
                yaml += `      column_id: ${foreignKeyData.targetRef.columnId}\n`
            }
            if (foreignKeyData.config?.targetNodeId)
              yaml += `    target_node_id: ${foreignKeyData.config.targetNodeId}\n`
            if (foreignKeyData.config?.targetColumn)
              yaml += `    target_column_name: ${foreignKeyData.config.targetColumn}\n`
            break
          }
          case 'unique': {
            const uniqueData = node.data as UniqueConstraintNodeData
            yaml += `    config_name: ${yamlSafe(uniqueData.configName || 'unnamed')}\n`
            yaml += `    table: ${yamlSafe(uniqueData.table)}\n`
            yaml += `    column: ${yamlSafe(uniqueData.column)}\n`
            if (uniqueData.constraintName)
              yaml += `    constraint_name: ${yamlSafe(uniqueData.constraintName)}\n`
            break
          }
          case 'notNull': {
            const notNullData = node.data as NotNullConstraintNodeData
            yaml += `    config_name: ${yamlSafe(notNullData.configName || 'unnamed')}\n`
            yaml += `    table: ${yamlSafe(notNullData.table)}\n`
            yaml += `    column: ${yamlSafe(notNullData.column)}\n`
            if (notNullData.constraintName)
              yaml += `    constraint_name: ${yamlSafe(notNullData.constraintName)}\n`
            break
          }
          case 'allowedValues': {
            const allowedData = node.data as AllowedValuesConstraintNodeData
            yaml += `    config_name: ${yamlSafe(allowedData.configName || 'unnamed')}\n`
            yaml += `    table: ${yamlSafe(allowedData.table)}\n`
            yaml += `    column: ${yamlSafe(allowedData.column)}\n`
            const allowedValuesArray = Array.isArray(allowedData.allowedValues)
              ? (allowedData.allowedValues as string[])
              : Array.from((allowedData.allowedValues as Set<string> | undefined) || [])
            yaml += `    allowed_values: ${JSON.stringify(allowedValuesArray)}\n`
            if (allowedData.sourceRef) {
              yaml += `    source_ref:\n`
              yaml += `      node_id: ${allowedData.sourceRef.nodeId}\n`
              yaml += `      column_id: ${allowedData.sourceRef.columnId}\n`
            }
            if (allowedData.constraintName)
              yaml += `    constraint_name: ${yamlSafe(allowedData.constraintName)}\n`
            break
          }
          case 'conditional': {
            const conditionalData = node.data as ConditionalConstraintNodeData
            yaml += `    config_name: ${yamlSafe(conditionalData.configName || 'unnamed')}\n`
            yaml += `    table: ${yamlSafe(conditionalData.table)}\n`
            yaml += `    if_column: ${yamlSafe(conditionalData.ifColumn)}\n`
            yaml += `    if_value: ${JSON.stringify(conditionalData.ifValue)}\n`
            if (conditionalData.ifLogic) yaml += `    if_logic: ${conditionalData.ifLogic}\n`
            if (conditionalData.ifConditions && conditionalData.ifConditions.length > 0) {
              yaml += `    if_conditions:\n`
              conditionalData.ifConditions.forEach((cond) => {
                yaml += `      - operator: ${cond.operator}\n`
                if (cond.column) yaml += `        column: ${cond.column}\n`
                if (cond.value !== undefined)
                  yaml += `        value: ${JSON.stringify(cond.value)}\n`
                if (cond.values) yaml += `        values: ${JSON.stringify(cond.values)}\n`
                if (cond.ref) {
                  yaml += `        ref:\n`
                  yaml += `          node_id: ${cond.ref.nodeId}\n`
                  yaml += `          column_id: ${cond.ref.columnId}\n`
                }
              })
            }
            yaml += `    then_column: ${yamlSafe(conditionalData.thenColumn)}\n`
            yaml += `    then_condition: ${JSON.stringify(conditionalData.thenConditionConfig)}\n`
            if (conditionalData.ifRef) {
              yaml += `    if_ref:\n`
              yaml += `      node_id: ${conditionalData.ifRef.nodeId}\n`
              yaml += `      column_id: ${conditionalData.ifRef.columnId}\n`
            }
            if (conditionalData.thenRef) {
              yaml += `    then_ref:\n`
              yaml += `      node_id: ${conditionalData.thenRef.nodeId}\n`
              yaml += `      column_id: ${conditionalData.thenRef.columnId}\n`
            }
            if (conditionalData.constraintName)
              yaml += `    constraint_name: ${yamlSafe(conditionalData.constraintName)}\n`
            break
          }
          case 'scripted': {
            const scriptedData = node.data as ScriptedConstraintNodeData
            yaml += `    config_name: ${yamlSafe(scriptedData.configName || 'unnamed')}\n`
            yaml += `    table: ${yamlSafe(scriptedData.table)}\n`
            yaml += `    script: ${yamlSafe(scriptedData.script)}\n`
            if (scriptedData.constraintName)
              yaml += `    constraint_name: ${yamlSafe(scriptedData.constraintName)}\n`
            break
          }
          case 'range': {
            const rangeData = node.data as RangeConstraintNodeData
            yaml += `    config_name: ${yamlSafe(rangeData.configName || 'unnamed')}\n`
            yaml += `    table: ${yamlSafe(rangeData.table)}\n`
            yaml += `    column: ${yamlSafe(rangeData.column)}\n`
            if (rangeData.minValue !== undefined) yaml += `    min_value: ${rangeData.minValue}\n`
            if (rangeData.maxValue !== undefined) yaml += `    max_value: ${rangeData.maxValue}\n`
            if (rangeData.boundaryMode) yaml += `    boundary_mode: ${rangeData.boundaryMode}\n`
            if (rangeData.sourceRef) {
              yaml += `    source_ref:\n`
              yaml += `      node_id: ${rangeData.sourceRef.nodeId}\n`
              yaml += `      column_id: ${rangeData.sourceRef.columnId}\n`
            }
            if (rangeData.constraintName)
              yaml += `    constraint_name: ${yamlSafe(rangeData.constraintName)}\n`
            break
          }
          case 'charset': {
            const charsetData = node.data as CharsetConstraintNodeData
            yaml += `    config_name: ${yamlSafe(charsetData.configName || 'unnamed')}\n`
            yaml += `    table: ${yamlSafe(charsetData.table)}\n`
            yaml += `    column: ${yamlSafe(charsetData.column)}\n`
            if (charsetData.charsetMode) yaml += `    charset_mode: ${charsetData.charsetMode}\n`
            if (charsetData.sourceRef) {
              yaml += `    source_ref:\n`
              yaml += `      node_id: ${charsetData.sourceRef.nodeId}\n`
              yaml += `      column_id: ${charsetData.sourceRef.columnId}\n`
            }
            if (charsetData.constraintName)
              yaml += `    constraint_name: ${yamlSafe(charsetData.constraintName)}\n`
            break
          }
          case 'dateLogic': {
            const dateLogicData = node.data as DateLogicConstraintNodeData
            yaml += `    config_name: ${yamlSafe(dateLogicData.configName || 'unnamed')}\n`
            yaml += `    table: ${yamlSafe(dateLogicData.table)}\n`
            yaml += `    column: ${yamlSafe(dateLogicData.column)}\n`
            if (dateLogicData.logicMode) yaml += `    logic_mode: ${dateLogicData.logicMode}\n`
            if (dateLogicData.compareOp) yaml += `    compare_op: ${dateLogicData.compareOp}\n`
            if (dateLogicData.referenceDate)
              yaml += `    reference_date: ${yamlSafe(dateLogicData.referenceDate)}\n`
            if (dateLogicData.referenceColumn)
              yaml += `    reference_column: ${yamlSafe(dateLogicData.referenceColumn)}\n`
            if (dateLogicData.calculationType)
              yaml += `    calculation_type: ${dateLogicData.calculationType}\n`
            if (dateLogicData.targetValue)
              yaml += `    target_value: ${yamlSafe(dateLogicData.targetValue)}\n`
            if (dateLogicData.targetColumn)
              yaml += `    target_column: ${yamlSafe(dateLogicData.targetColumn)}\n`
            if (dateLogicData.sourceRef) {
              yaml += `    source_ref:\n`
              yaml += `      node_id: ${dateLogicData.sourceRef.nodeId}\n`
              yaml += `      column_id: ${dateLogicData.sourceRef.columnId}\n`
            }
            if (dateLogicData.constraintName)
              yaml += `    constraint_name: ${yamlSafe(dateLogicData.constraintName)}\n`
            break
          }
          case 'composite': {
            // 复合约束：聚合多个子约束（通过 includedNodeIds 引用画布上的其他约束节点）
            const compositeData = node.data as CompositeConstraintNodeData
            const compositeExtra = node.data as unknown as Record<string, unknown>
            yaml += `    config_name: ${yamlSafe(compositeData.configName || 'unnamed')}\n`
            // table 是可选锚点字段，不在 CompositeConstraintNodeData 类型中，通过 Record 安全访问
            if (compositeExtra.table)
              yaml += `    table: ${yamlSafe(compositeExtra.table as string)}\n`
            yaml += `    logic: ${compositeData.logic || 'all'}\n`
            const subNodeIds = compositeData.includedNodeIds || []
            if (subNodeIds.length > 0) {
              // 将子约束节点 ID 映射回其约束类型，序列化为 sub_constraints
              yaml += `    sub_constraints:\n`
              subNodeIds.forEach((subId) => {
                const subNode = constraintNodes.find((n) => n.id === subId)
                const subType = subNode
                  ? getConstraintKindByNodeType(subNode.type) || 'scripted'
                  : 'scripted'
                yaml += `      - id: ${subId}\n`
                yaml += `        type: ${subType}\n`
              })
            }
            if (compositeData.constraintName)
              yaml += `    constraint_name: ${yamlSafe(compositeData.constraintName)}\n`
            break
          }
        }

        if (index < constraintNodes.length - 1) {
          yaml += '\n'
        }
      })
    }

    if (assets.value.length > 0) {
      yaml += '\n' + t('messages.persistence.comments.assetsConfig')
      yaml += 'assets:\n'

      assets.value.forEach((asset, index) => {
        yaml += `  ${yamlSafe(asset.configName)}:\n`
        yaml += `    table_name: ${yamlSafe(asset.tableName)}\n`
        yaml += `    sheet_name: ${yamlSafe(asset.sheetName)}\n`
        yaml += `    columns:\n`

        asset.columns.forEach((column) => {
          yaml += `      - column_name: ${yamlSafe(column.columnName)}\n`
          yaml += `        data_type: ${column.dataType}\n`
        })

        if (index < assets.value.length - 1) {
          yaml += '\n'
        }
      })
    }

    return yaml
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

    const schemaData = node.data as SchemaNodeData
    let yaml = `# Schema配置: ${schemaData.configName}\n`
    yaml += `table_name: ${yamlSafe(schemaData.tableName)}\n`
    yaml += `sheet_name: ${yamlSafe(schemaData.sheetName)}\n`
    yaml += `columns:\n`

    schemaData.columns.forEach((column) => {
      yaml += `  - column_name: ${yamlSafe(column.columnName)}\n`
      yaml += `    data_type: ${column.dataType}\n`
    })

    return yaml
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
