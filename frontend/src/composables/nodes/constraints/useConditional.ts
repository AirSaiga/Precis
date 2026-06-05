/**
 * @file useConditional.ts
 * @description 条件约束组合式函数
 *
 * 功能概述:
 * - 提供条件约束节点的业务逻辑处理
 * - 支持 IF-THEN 条件验证模式
 * - 支持多条件组合（AND/OR 逻辑）
 * - 支持无条件触发（skipIfCondition）
 * - 支持列间比较（ref_column）
 * - 支持 TransformOutput 节点作为 IF/THEN 源
 * - 支持多种操作符：eq, ne, gt, gte, lt, lte, in, not_null 等
 *
 * 架构设计:
 * - 基于 Vue3 Composition API 的组合式函数
 * - 继承 useConstraintBase 的基础能力
 * - 与 graphStore 集成，管理节点状态
 * - 调用后端 validationApi 执行实际数据校验
 */

import { logger } from '@/core/utils/logger'
import { useConstraintBase } from './useConstraintBase'
import type { ConditionalConstraintNodeData } from '../types'
import { useGraphStore } from '@/stores/graphStore'
import { validateConditional, type ConditionalValidationRequest } from '@/api/validationApi'
import { tryInlineValidation } from '@/composables/nodes/constraints/tryInlineValidation'

/**
 * 条件约束支持的标量值类型
 */
type ConditionalScalar = string | number | boolean

/**
 * 尝试将字符串解析为标量值
 */
const tryParseScalar = (raw: string): ConditionalScalar | undefined => {
  const s = raw.trim()
  if (!s) return undefined

  const lower = s.toLowerCase()
  if (lower === 'true') return true
  if (lower === 'false') return false

  const hasUnsafeLeadingZero = /^[-+]?0\d+/.test(s)

  const intPattern = /^[-+]?\d+$/
  if (intPattern.test(s) && !hasUnsafeLeadingZero) {
    const n = Number.parseInt(s, 10)
    if (Number.isFinite(n)) return n
  }

  const floatPattern = /^[-+]?(?:\d+\.\d+|\d+\.\d*|\.\d+)$/
  const sciPattern = /^[-+]?(?:\d+\.?\d*|\.\d+)[eE][-+]?\d+$/
  if ((floatPattern.test(s) || sciPattern.test(s)) && !hasUnsafeLeadingZero) {
    const n = Number.parseFloat(s)
    if (Number.isFinite(n)) return n
  }

  return undefined
}

/**
 * 构建 "in" 操作符的候选值列表
 */
const buildInValuesPayload = (values: unknown): Array<string | number | boolean> => {
  const list = Array.isArray(values) ? values : []
  const result: Array<string | number | boolean> = []
  const seen = new Set<string>()
  const pushUnique = (v: string | number | boolean) => {
    const key = `${typeof v}:${String(v)}`
    if (seen.has(key)) return
    seen.add(key)
    result.push(v)
  }

  for (const item of list) {
    const s = item === null || item === undefined ? '' : String(item).trim()
    if (!s || s === '...') continue
    pushUnique(s)
    const parsed = tryParseScalar(s)
    if (parsed !== undefined) {
      pushUnique(parsed)
    }
  }

  return result
}

/**
 * 规范化 THEN 条件配置
 */
const normalizeThenCondition = (raw: ConditionalConstraintNodeData['thenConditionConfig']) => {
  if (typeof raw === 'string') {
    return raw.trim()
  }
  if (!raw || typeof raw !== 'object') {
    return { operator: 'not_null' }
  }

  const cfg = raw as { operator?: string; value?: unknown; values?: unknown; ref_column?: unknown }
  if (!cfg.operator) {
    return { operator: 'not_null' }
  }
  if (cfg.operator === 'not_null') {
    return { operator: 'not_null' }
  }
  if (cfg.operator === 'greater_than') {
    if (typeof cfg.value === 'number' && Number.isFinite(cfg.value)) {
      return { operator: 'greater_than', value: cfg.value }
    }
    if (typeof cfg.value === 'string') {
      const parsed = tryParseScalar(cfg.value)
      if (typeof parsed === 'number') {
        return { operator: 'greater_than', value: parsed }
      }
      return { operator: 'greater_than', value: cfg.value.trim() }
    }
    return { operator: 'greater_than', value: cfg.value }
  }
  if (cfg.operator === 'in') {
    return { operator: 'in', values: buildInValuesPayload(cfg.values) }
  }
  // 列间比较：保留 ref_column
  if (cfg.ref_column !== undefined) {
    return { operator: cfg.operator, ref_column: cfg.ref_column }
  }

  return raw
}

/**
 * 从 graphStore 解析节点对应的列名
 * 支持 schema 和 transformOutput 节点类型
 */
function resolveColumnName(
  store: ReturnType<typeof useGraphStore>,
  nodeId: string,
  columnId: string
): string | undefined {
  const node = store.nodes.find((n) => n.id === nodeId)
  if (!node) return undefined

  if (node.type === 'schema') {
    const columns = (node.data as Record<string, unknown>).columns as
      | Array<{ id: string; columnName: string }>
      | undefined
    return columns?.find((c) => c.id === columnId)?.columnName
  }

  if (node.type === 'transformOutput' || node.type === 'manualData') {
    return (node.data as Record<string, unknown>).columnName as string | undefined
  }

  return undefined
}

/**
 * 判断节点是否为可连接的数据源（schema 或 transformOutput）
 */
function isDataSourceNode(type: string | undefined): boolean {
  return type === 'schema' || type === 'transformOutput' || type === 'manualData'
}

export function useConditional(
  props: { id: string; data: ConditionalConstraintNodeData },
  emit: any
) {
  const base = useConstraintBase(props, emit)
  const store = useGraphStore()

  /**
   * 执行条件约束验证
   *
   * 支持场景：
   * 1. 传统 Schema → Conditional：IF/THEN 来自同一张 Schema 表
   * 2. TransformOutput → Conditional：IF/THEN 来自 Transform 生成的派生列
   * 3. 无条件触发：不检查 IF，直接对所有行执行 THEN
   * 4. 列间比较：THEN 条件使用 ref_column 引用另一列
   */
  const performValidation = async () => {
    logger.debug('🔄 执行条件验证:', props.id)

    try {
      const emptyResult = {
        errorCount: 0,
        totalRows: 0,
        errors: [] as Array<{ row: number; value: unknown; message: string | undefined }>,
      }

      const thenRef = props.data.thenRef
      const skipIf = props.data.skipIfCondition

      // THEN 列必须已连接
      if (!thenRef?.nodeId || !thenRef?.columnId) {
        store.updateNodeData(props.id, {
          validationStatus: 'idle',
          validationErrors: [],
          lastValidation: undefined,
        })
        return emptyResult
      }

      const thenNode = store.nodes.find((n) => n.id === thenRef.nodeId)
      if (!thenNode || !isDataSourceNode(thenNode.type)) {
        store.updateNodeData(props.id, {
          validationStatus: 'missing',
          validationErrors: ['THEN 列引用的节点不存在或类型不支持'],
          lastValidation: undefined,
        })
        return emptyResult
      }

      // 解析 THEN 列名
      const thenColumnName = resolveColumnName(store, thenRef.nodeId, thenRef.columnId)
      if (!thenColumnName) {
        store.updateNodeData(props.id, {
          validationStatus: 'missing',
          validationErrors: ['THEN 列不存在或已删除'],
          lastValidation: undefined,
        })
        return emptyResult
      }

      // 处理 IF 条件
      let ifConditionsPayload: Array<Record<string, unknown>> = []
      let hasValidIf = false

      if (!skipIf) {
        const rawIfConditions =
          Array.isArray(props.data.ifConditions) && props.data.ifConditions.length > 0
            ? props.data.ifConditions
            : [
                {
                  ref: props.data.ifRef
                    ? { nodeId: props.data.ifRef.nodeId, columnId: props.data.ifRef.columnId }
                    : undefined,
                  column: props.data.ifColumn,
                  operator: 'eq' as const,
                  value: props.data.ifValue,
                },
              ]

        const configuredIfConditions = rawIfConditions.filter(
          (c) => !!c?.ref?.nodeId && !!c?.ref?.columnId
        )

        if (configuredIfConditions.length === 0) {
          store.updateNodeData(props.id, {
            validationStatus: 'missing',
            validationErrors: ['未配置 IF 条件，请连接 IF 列或启用"无条件触发"'],
            lastValidation: undefined,
          })
          return emptyResult
        }

        // 同源检查：仅当所有节点都是 schema 类型时才要求同源
        const ifNodes = configuredIfConditions
          .map((c) => store.nodes.find((n) => n.id === c.ref!.nodeId))
          .filter(Boolean)
        const allSchema = thenNode.type === 'schema' && ifNodes.every((n) => n?.type === 'schema')

        if (allSchema) {
          const mismatch = configuredIfConditions.some((c) => c.ref?.nodeId !== thenRef.nodeId)
          if (mismatch) {
            store.updateNodeData(props.id, {
              validationStatus: 'missing',
              validationErrors: ['IF/THEN 必须来自同一个 Schema 节点'],
              lastValidation: undefined,
            })
            return emptyResult
          }
        }

        // 解析 IF 列名
        const resolvedIfConditions = configuredIfConditions.map((c) => {
          const colName = resolveColumnName(store, c.ref!.nodeId, c.ref!.columnId)
          return {
            operator: c.operator,
            columnName: colName,
            value: c.value,
            values: c.values,
          }
        })

        const missingIfColumn = resolvedIfConditions.some((c) => !c.columnName)
        if (missingIfColumn) {
          store.updateNodeData(props.id, {
            validationStatus: 'missing',
            validationErrors: ['IF 列不存在或已删除'],
            lastValidation: undefined,
          })
          return emptyResult
        }

        ifConditionsPayload = resolvedIfConditions.map((c) => {
          if (c.operator === 'not_null') {
            return { if_column: c.columnName, operator: 'not_null' }
          }
          if (c.operator === 'in') {
            const values = Array.isArray(c.values) ? c.values : []
            return { if_column: c.columnName, operator: 'in', values: buildInValuesPayload(values) }
          }
          if (c.operator === 'greater_than') {
            const raw = String(c.value ?? '').trim()
            const parsed = tryParseScalar(raw)
            const v: unknown = parsed !== undefined ? parsed : raw
            return { if_column: c.columnName, operator: 'greater_than', value: v }
          }
          const raw = String(c.value ?? '').trim()
          const parsed = tryParseScalar(raw)
          const v: unknown = parsed !== undefined ? parsed : raw
          return { if_column: c.columnName, operator: c.operator, value: v }
        })

        hasValidIf = true
      }

      // 获取数据源文件信息（仅 schema 节点有，transformOutput 节点没有）
      const sourceSchemaData = base.sourceInfo.value
      if (!sourceSchemaData) {
        return emptyResult
      }

      const isInlineSource = thenNode.type === 'transformOutput' || thenNode.type === 'manualData'

      if (isInlineSource) {
        await tryInlineValidation(store, thenRef, props.id)
        return emptyResult
      }

      if (!sourceSchemaData.sourceFile) {
        return {
          errorCount: 0,
          totalRows: 0,
          errors: [],
        }
      }

      const sourceFilePath = sourceSchemaData.sourceFilePath
      const localPath = sourceSchemaData.localPath
      const sheetName = sourceSchemaData.sheetName
      const headerRow = sourceSchemaData.headerRow

      if (!sourceFilePath) {
        store.updateNodeData(props.id, {
          validationStatus: 'missing',
          validationErrors: ['缺少数据源文件信息，无法执行校验'],
          lastValidation: undefined,
        })
        return emptyResult
      }

      const actualFilePath = localPath || sourceFilePath

      const validationConfig: Record<string, unknown> = {
        if_logic: props.data.ifLogic || 'and',
        then_column: thenColumnName,
        then_condition: normalizeThenCondition(props.data.thenConditionConfig),
        then_condition_config: props.data.thenConditionConfig,
      }

      if (hasValidIf && ifConditionsPayload.length > 0) {
        validationConfig.if_conditions = ifConditionsPayload
        validationConfig.if_column = ifConditionsPayload[0]?.if_column
        validationConfig.if_value = (
          ifConditionsPayload[0] as { value?: unknown } | undefined
        )?.value
      } else if (skipIf) {
        // 无条件触发：发送空 if_conditions
        validationConfig.if_conditions = []
      }

      const response = await validateConditional({
        validation_type: 'conditional',
        target_column_name: thenColumnName,
        source_file_path: String(actualFilePath),
        sheet_name: sheetName,
        header_row: headerRow,
        validation_config: validationConfig,
      } as unknown as ConditionalValidationRequest)

      if (!response.success || !response.data) {
        store.updateNodeData(props.id, {
          validationStatus: 'error',
          validationErrors: response.error ? [String(response.error)] : ['条件约束校验失败'],
          lastValidation: undefined,
        })
        return emptyResult
      }

      const errorRows = response.data.error_rows || []
      const errorCount = errorRows.length
      const totalRows = response.data.total_rows || 0
      const matchCount = Math.max(0, totalRows - errorCount)

      const formattedErrors = errorRows.map((err: any) => ({
        row: err.row_index,
        value: err.cell_value,
        message: err.error_message,
      }))

      store.updateNodeData(props.id, {
        validationStatus: errorCount > 0 ? 'error' : 'pass',
        validationErrors: formatConditionalErrors(formattedErrors),
        lastValidation: { totalRows, errorCount, matchCount },
      })

      return {
        errorCount,
        totalRows,
        errors: formattedErrors,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      store.updateNodeData(props.id, {
        validationStatus: 'error',
        validationErrors: [message],
        lastValidation: undefined,
      })
      return {
        errorCount: 0,
        totalRows: 0,
        errors: [],
      }
    }
  }

  const formatConditionalErrors = (errors: any[]): string[] => {
    return (errors || []).map((err) => {
      const rowIndex = typeof err.row === 'number' ? err.row : err.row_index
      const msg = err.message || err.error_message || '不满足条件'
      if (typeof rowIndex === 'number') return `第 ${rowIndex + 1} 行: ${msg}`
      return String(msg)
    })
  }

  return {
    ...base,
    performValidation,
    formatConditionalErrors,
  }
}
