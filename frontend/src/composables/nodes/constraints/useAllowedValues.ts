/**
 * @file useAllowedValues.ts
 * @description 允许值约束
 * 负责允许值约束的特定逻辑
 * 提供允许值约束节点的验证方法和数据处理功能
 *
 * 关键设计点（避免"允许值设置正确仍报错"）：
 * - 后端会使用 pandas `Series.isin(allowed_values)` 判断是否命中允许集合
 * - Excel/CSV 读取后，列可能被推断为 number / boolean，而前端输入通常是 string
 * - 若仅发送 string[]，将导致类型不一致，从而全部判定为"不在集合中"
 *
 * 因此这里对 allowed_values 做"双编码"：
 * - 每个输入值始终发送 trim 后的字符串；
 * - 若该字符串可安全解析为 number/bool（且不存在前导零等歧义），再额外发送解析后的标量；
 * - 这样能同时兼容"列是字符串"和"列是数字/布尔"的两类数据源
 *
 * 注：IndexedDB 模式已在 2026年3月移除
 */

import { logger } from '@/core/utils/logger'
import { useConstraintBase } from './useConstraintBase'
import { useGraphStore } from '@/stores/graphStore'
import { validateAllowedValues } from '@/api/validationApi'
import type { AllowedValuesConstraintNodeData } from '@/types/graph'

/**
 * 格式化数值为字符串
 * @param value - 待格式化的值
 * @returns 格式化后的字符串
 */
function formatNumericValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  const num = Number(value)
  if (isNaN(num)) return String(value)
  if (Number.isInteger(num)) return String(num)
  return String(num)
}

/**
 * 允许值校验请求体中 allowed_values 的元素类型（前端侧）
 *
 * 注意：后端会将 allowed_values 直接转为 set 后用于 pandas isin
 * 这里允许 string/number/boolean 混合，是为了与 pandas 推断出的列类型对齐
 */
type AllowedValuesPayloadScalar = string | number | boolean

/**
 * 将用户输入（字符串）解析为更接近 pandas 列类型的标量
 *
 * 解析规则（关键在"安全"）：
 * - 支持 true/false（忽略大小写）；
 * - 支持整数/小数/科学计数法；
 * - 避免将含前导零的数字（如 001）误解析为 number
 *   - 001 可能是业务编码，应保留为字符串；
 *   - 仅当不存在前导零歧义时才转成 number
 *
 * @param raw - 原始输入
 * @returns 可安全解析的标量；无法解析则返回 undefined
 */
const tryParseAllowedScalar = (raw: string): AllowedValuesPayloadScalar | undefined => {
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
 * 构建发送给后端的 allowed_values 数组（做双编码与去重）
 *
 * 为什么要"字符串 + 解析标量"双编码？
 * - 若 df[col] 是 object/string：需要命中字符串值
 * - 若 df[col] 是 int/float/bool：需要命中数字/布尔值
 * - 同时发送两种形式可以显著降低类型不兼容导致的误报
 *
 * @param strings - 已经过滤/trim 的允许值（字符串形态）
 * @returns 双编码后的允许值数组（包含字符串和解析后的标量）
 */
const buildAllowedValuesPayload = (strings: string[]): AllowedValuesPayloadScalar[] => {
  const result: AllowedValuesPayloadScalar[] = []
  const seen = new Set<string>()
  const pushUnique = (v: AllowedValuesPayloadScalar) => {
    const key = `${typeof v}:${String(v)}`
    if (seen.has(key)) return
    seen.add(key)
    result.push(v)
  }

  for (const s of strings) {
    const trimmed = String(s).trim()
    if (!trimmed || trimmed === '...') continue
    pushUnique(trimmed)
    const parsed = tryParseAllowedScalar(trimmed)
    if (parsed !== undefined) {
      pushUnique(parsed)
    }
  }

  return result
}

/**
 * 允许值约束 Composable
 * @param props - 组件属性
 * @param props.id - 节点唯一标识符
 * @param props.data - 节点数据
 * @param emit - Vue的emit函数，用于通知父组件
 * @returns 允许值约束相关的方法和状态
 */
export function useAllowedValues(
  props: { id: string; data: AllowedValuesConstraintNodeData },
  emit: any
) {
  /**
   * 复用约束通用能力（事件协调、基础结构）
   *
   * 注意：允许值节点的校验数据源不是用 base.sourceInfo 推导出来的，
   * 而是通过 sourceRef（Schema nodeId + columnId）反查 Schema/SourcePreview
   * 这样能避免"表名/列名字符串变更导致的关联丢失"
   */
  const base = useConstraintBase(props, emit)

  /** 图数据中心：用于反查 Schema/SourcePreview，并写回节点校验状态 */
  const store = useGraphStore()

  /**
   * 根据 Schema 节点与列 ID 获取列名
   * 使用稳定引用避免列名重命名导致的关联丢失
   *
   * @param schemaNodeId - Schema 节点 ID
   * @param columnId - 列 ID
   * @returns 列名，如果未找到则返回 null
   */
  const getSchemaColumnName = (schemaNodeId: string, columnId: string) => {
    const node = store.nodes.find((n) => n.id === schemaNodeId)
    if (!node || node.type !== 'schema') return null
    const columns = ((node.data as unknown) as Record<string, unknown>).columns || []
    const col = (columns as Array<{ id: string; columnName: string }>).find((c) => c.id === columnId)
    return col?.columnName || null
  }

  /**
   * 执行允许值约束验证
   *
   * 验证流程：
   * Step 1: 解析连接关系（源表）- 检查 sourceRef 是否存在
   * Step 2: 解析源数据源 - 获取文件路径和工作表信息
   * Step 3: 执行后端校验 - 调用 validationApi
   *
   * 架构变更（2026年3月）：
   * - 移除了 IndexedDB 模式支持
   * - 现在只使用本地文件路径模式
   *
   * @returns 包含 errorCount, totalRows, errors 的验证结果
   */
  const performValidation = async () => {
    logger.debug('🔄 执行允许值验证:', props.id)

    try {
      const emptyResult = {
        errorCount: 0,
        totalRows: 0,
        errors: [] as Array<{ row: number; value: unknown; message: string | undefined }>,
      }

      const sourceNodeId = props.data.sourceRef?.nodeId
      if (!sourceNodeId) {
        store.updateNodeData(props.id, {
          validationStatus: 'idle',
          validationErrors: [],
          lastValidation: undefined,
        })
        return emptyResult
      }

      const sourceNode = store.nodes.find((n) => n.id === sourceNodeId)
      if (!sourceNode) {
        store.updateNodeData(props.id, {
          validationStatus: 'missing',
          validationErrors: ['找不到源节点，请重新连接'],
          lastValidation: undefined,
        })
        return emptyResult
      }

      if (sourceNode.type !== 'schema') {
        store.updateNodeData(props.id, {
          validationStatus: 'missing',
          validationErrors: ['允许值校验的源必须是 Schema 节点'],
          lastValidation: undefined,
        })
        return emptyResult
      }

      const sourceSchemaData = sourceNode.data as unknown as Record<string, unknown>
      const sourceFilePath = sourceSchemaData.sourceFilePath
      const localPath = sourceSchemaData.localPath
      const sheetName = sourceSchemaData.sheetName
      const headerRow = sourceSchemaData.headerRow

      if (!sourceSchemaData.sourceFile) {
        return emptyResult
      }

      if (!sourceFilePath) {
        store.updateNodeData(props.id, {
          validationStatus: 'missing',
          validationErrors: ['源表未连接数据源，无法执行允许值校验'],
          lastValidation: undefined,
        })
        return emptyResult
      }

      const actualFilePath = localPath || sourceFilePath

      const sourceColumnName = props.data.sourceRef
        ? getSchemaColumnName(props.data.sourceRef.nodeId, props.data.sourceRef.columnId)
        : props.data.column

      if (!sourceColumnName) {
        store.updateNodeData(props.id, {
          validationStatus: 'missing',
          validationErrors: ['源列不存在或已删除，无法执行允许值校验'],
          lastValidation: undefined,
        })
        return emptyResult
      }

      const allowedValueStrings = Array.from(props.data.allowedValues || [])
        .map((v) => String(v).trim())
        .filter((v) => v && v !== '...')

      if (allowedValueStrings.length === 0) {
        store.updateNodeData(props.id, {
          validationStatus: 'idle',
          validationErrors: ['请先配置允许值列表后再进行校验'],
          lastValidation: undefined,
        })
        return emptyResult
      }

      const allowedValuesPayload = buildAllowedValuesPayload(allowedValueStrings)
      const validationConfig = {
        allowed_values: allowedValuesPayload,
      }

      const response = await validateAllowedValues({
        validation_type: 'allowed_values',
        target_column_name: sourceColumnName,
        source_file_path: String(actualFilePath),
        sheet_name: sheetName as string,
        header_row: headerRow as number,
        validation_config: validationConfig,
      })

      if (!response.success || !response.data) {
        store.updateNodeData(props.id, {
          validationStatus: 'error',
          validationErrors: response.error ? [String(response.error)] : ['允许值校验失败'],
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
        validationErrors: formatAllowedValuesErrors(formattedErrors),
        lastValidation: {
          totalRows,
          errorCount,
          matchCount,
        },
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

  /**
   * 格式化允许值约束的错误信息
   * @param errors - 错误行数组
   * @returns 格式化后的错误信息字符串数组
   */
  const formatAllowedValuesErrors = (errors: any[]): string[] => {
    return errors.map((err) => {
      const rowNumber = Number(err.row)
      const valueText =
        err.value === null || err.value === undefined ? '' : formatNumericValue(err.value)
      const fallbackMessage = valueText
        ? `值 "${valueText}" 不在允许值列表中`
        : '值不在允许值列表中'
      return `第 ${Number.isFinite(rowNumber) ? rowNumber + 1 : '-'} 行: ${err.message || fallbackMessage}`
    })
  }

  return {
    ...base,
    performValidation,
    formatAllowedValuesErrors,
  }
}
