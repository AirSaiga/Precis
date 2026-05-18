/**
 * @file constraintFactory.ts
 * @description 约束节点工厂模块 - 负责创建各类数据质量约束节点
 *
 * 约束节点是数据质量校验的核心载体，本模块负责创建以下类型的约束节点：
 * - Unique: 唯一性约束
 * - NotNull: 非空约束
 * - AllowedValues: 允许值约束
 * - ForeignKey: 外键约束
 * - Conditional: 条件约束
 * - Scripted: 脚本约束
 * - Range: 范围约束
 * - Charset: 字符集约束
 * - DateLogic: 日期逻辑约束
 * - Composite: 复合约束
 *
 * 架构设计：
 * - 使用工厂方法模式，通过 constraintType 参数分发到不同的 data 组装逻辑
 * - 使用 createBaseNodeFactory 消除重复的节点创建样板
 * - 节点类型从 validationRegistry 动态获取，新增约束类型时无需修改工厂
 *
 * @module graphStore/modules/factories
 */

import type { Ref } from 'vue'
import i18n from '@/i18n'
import type { CustomNode } from '@/types/graph'
import type { ConstraintKind } from '@/services/constraints/types'
import { getConstraintMetaByKind } from '@/services/constraints/validationRegistry'
import { createBaseNodeFactory } from './createBaseNodeFactory'

export function createConstraintFactoryModule(params: {
  nodes: Ref<CustomNode[]>
  selectedNodeId: Ref<string | null>
}) {
  const { nodes, selectedNodeId } = params
  const createNode = createBaseNodeFactory({ nodes, selectedNodeId })

  function getConstraintTypeName(type: string): string {
    const names: Record<string, string> = {
      foreignKey: i18n.global.t('factories.foreignKey'),
      unique: i18n.global.t('factories.unique'),
      notNull: i18n.global.t('factories.notNull'),
      allowedValues: i18n.global.t('factories.allowedValues'),
      conditional: i18n.global.t('factories.conditional'),
      scripted: i18n.global.t('factories.scripted'),
      range: i18n.global.t('factories.range'),
      charset: i18n.global.t('factories.charset'),
      dateLogic: i18n.global.t('factories.dateLogic'),
      composite: i18n.global.t('factories.composite'),
    }
    return names[type] || i18n.global.t('factories.unknown')
  }

  function getDefaultConstraintData(type: string): Record<string, unknown> {
    const defaults: Record<string, Record<string, unknown>> = {
      foreignKey: {
        sourceTable: 'source_table',
        sourceColumn: 'source_column',
        targetTable: 'target_table',
        targetColumn: '',
      },
      unique: {
        table: 'table_name',
        columns: ['column_name'],
      },
      notNull: {
        table: 'table_name',
        column: 'column_name',
      },
      allowedValues: {
        table: 'table_name',
        column: 'column_name',
        allowedValues: ['value1', 'value2'],
      },
      conditional: {
        table: 'table_name',
        ifColumn: 'if_column',
        ifValue: 'if_value',
        thenColumn: 'then_column',
        thenConditionConfig: {},
      },
      scripted: {
        table: 'table_name',
        script: '',
      },
      range: {
        table: 'table_name',
        column: 'column_name',
        minValue: 0,
        maxValue: 100,
        boundaryMode: 'inclusive',
      },
      charset: {
        table: 'table_name',
        column: 'column_name',
        charsetMode: 'ascii',
      },
      dateLogic: {
        table: 'table_name',
        column: 'column_name',
        logicMode: 'compare',
        compareOp: 'gt',
        referenceDate: '',
        referenceColumn: '',
        calculationType: 'age',
        targetValue: '',
        targetColumn: '',
      },
      composite: {
        logic: 'all',
        subGraph: { nodes: [], edges: [] },
      },
    }
    return defaults[type] || {}
  }

  function createConstraintNode(
    position: { x: number; y: number },
    constraintType: ConstraintKind,
    data?: Record<string, unknown>
  ) {
    const constraintTypeName = getConstraintTypeName(constraintType)
    const meta = getConstraintMetaByKind(constraintType)
    if (!meta) {
      throw new Error(`Unknown constraint type: ${constraintType}`)
    }
    const nodeType = meta.nodeType
    const configName = i18n.global.t('factories.newConstraint', { type: constraintTypeName })

    switch (constraintType) {
      case 'foreignKey':
        return createNode(nodeType, position, {
          configName,
          sourceTable: (data?.sourceTable as string) || 'source_table',
          sourceColumn: (data?.sourceColumn as string) || 'source_column',
          targetTable: (data?.targetTable as string) || 'target_table',
          targetColumn: (data?.targetColumn as string) || 'target_column',
          constraintName: data?.constraintName as string | undefined,
          validationStatus: 'idle',
        })

      case 'unique':
        return createNode(nodeType, position, {
          configName,
          table: (data?.table as string) || 'table_name',
          column: (data?.column as string) || 'column_name',
          constraintName: data?.constraintName as string | undefined,
        })

      case 'notNull':
        return createNode(nodeType, position, {
          configName,
          table: (data?.table as string) || 'table_name',
          column: (data?.column as string) || 'column_name',
          constraintName: data?.constraintName as string | undefined,
        })

      case 'allowedValues':
        return createNode(nodeType, position, {
          configName,
          table: (data?.table as string) || 'table_name',
          column: (data?.column as string) || 'column_name',
          allowedValues: new Set((data?.allowedValues as string[]) || ['value1', 'value2']),
          constraintName: data?.constraintName as string | undefined,
          validationStatus: 'idle',
          validationErrors: [],
          lastValidation: undefined,
          sourceRef: undefined,
        })

      case 'conditional':
        return createNode(nodeType, position, {
          configName,
          table: (data?.table as string) || 'target_table',
          ifColumn: (data?.ifColumn as string) || 'if_column',
          ifValue: (data?.ifValue as string) || 'if_value',
          ifLogic: 'and',
          ifConditions: [{ operator: 'eq', value: (data?.ifValue as string) || '' }],
          thenColumn: (data?.thenColumn as string) || 'then_column',
          thenConditionConfig:
            (data?.thenConditionConfig as Record<string, unknown> | string) || {},
          constraintName: data?.constraintName as string | undefined,
          validationStatus: 'idle',
          validationErrors: [],
          lastValidation: undefined,
          ifRef: undefined,
          thenRef: undefined,
        })

      case 'scripted':
        return createNode(nodeType, position, {
          configName,
          table: (data?.table as string) || 'table_name',
          column: (data?.column as string) || undefined,
          script: (data?.script as string) || '',
          constraintName: data?.constraintName as string | undefined,
        })

      case 'range':
        return createNode(nodeType, position, {
          configName,
          table: (data?.table as string) || 'table_name',
          column: (data?.column as string) || 'column_name',
          minValue: (data?.minValue as number) ?? 0,
          maxValue: (data?.maxValue as number) ?? 100,
          boundaryMode: (data?.boundaryMode as 'inclusive' | 'exclusive') || 'inclusive',
          constraintName: data?.constraintName as string | undefined,
          validationStatus: 'idle',
          validationErrors: [],
          lastValidation: undefined,
          sourceRef: undefined,
        })

      case 'charset':
        return createNode(nodeType, position, {
          configName,
          table: (data?.table as string) || 'table_name',
          column: (data?.column as string) || 'column_name',
          charsetMode: (data?.charsetMode as 'ascii' | 'chinese') || 'ascii',
          constraintName: data?.constraintName as string | undefined,
          validationStatus: 'idle',
          validationErrors: [],
          lastValidation: undefined,
          sourceRef: undefined,
        })

      case 'dateLogic':
        return createNode(nodeType, position, {
          configName,
          table: (data?.table as string) || 'table_name',
          column: (data?.column as string) || 'column_name',
          logicMode: (data?.logicMode as 'compare' | 'calculation') || 'compare',
          compareOp: (data?.compareOp as 'gt' | 'lt' | 'eq' | 'gte' | 'lte' | 'range') || 'gt',
          referenceDate: (data?.referenceDate as string) || '',
          referenceColumn: (data?.referenceColumn as string) || '',
          calculationType: (data?.calculationType as 'age' | 'days_diff') || 'age',
          targetValue: (data?.targetValue as string) || '',
          targetColumn: (data?.targetColumn as string) || '',
          constraintName: data?.constraintName as string | undefined,
          validationStatus: 'idle',
          validationErrors: [],
          lastValidation: undefined,
          sourceRef: undefined,
        })

      case 'composite':
        return createNode(nodeType, position, {
          configName,
          logic: (data?.logic as 'all' | 'any' | 'none') || 'all',
          subGraph: (data?.subGraph as { nodes: any[]; edges: any[] }) || { nodes: [], edges: [] },
          inputColumn: (data?.inputColumn as string) || undefined,
          inputFromNode: (data?.inputFromNode as string) || undefined,
          constraintName: data?.constraintName as string | undefined,
          validationStatus: 'idle',
          validationErrors: [],
          lastValidation: undefined,
          sourceRef: undefined,
        })

      default: {
        const defaultData = getDefaultConstraintData(constraintType)
        return createNode(nodeType, position, {
          configName,
          table: (data?.table as string) || 'table_name',
          column: (data?.column as string) || 'column_name',
          ...defaultData,
          ...data,
        })
      }
    }
  }

  return {
    getConstraintTypeName,
    getDefaultConstraintData,
    createConstraintNode,
  }
}
