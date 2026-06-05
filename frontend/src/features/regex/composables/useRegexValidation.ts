/**
 * @file useRegexValidation.ts
 * @description 正则表达式校验逻辑组合式函数
 *
 * 【业务场景】
 * 这是正则表达式节点的核心业务逻辑模块，
 * 负责处理正则校验的完整流程，包括：
 * 1. 校验请求的发起和响应处理
 * 2. 校验状态的更新和管理
 * 3. 派生列的生成和写回
 * 4. 连接线状态的同步
 *
 * 【数据流】
 * RegexNode (用户点击校验)
 *   ↓ handleRegexValidate()
 *   ↓ performRegexValidation()
 *   ↓ validateAndExtractRegex() (API 调用)
 *   ↓
 * 1. 更新节点状态 (pass/error/idle)
 * 2. extract 模式：生成派生列并写回
 * 3. 更新连接线样式
 *
 * 【模块职责】
 * - 暴露给 UI 层的入口函数
 * - 协调各子模块完成校验流程
 * - 处理校验结果的更新和持久化
 *
 * 【依赖模块】
 * - graphStore: 节点数据的读取和更新
 * - validateAndExtractRegex: API 调用
 * - regexOutputMapping: 输出映射解析和类型转换
 */

import { logger } from '@/core/utils/logger'
import { useGraphStore } from '@/stores/graphStore'
import type { DataType } from '@/types/common'
import type {
  RegexNodeData,
  SchemaNodeData,
  SourcePreviewNodeData,
  SchemaColumn,
  TransformOutputNodeData,
} from '@/types/graph'
import { validateAndExtractRegex } from '@/features/regex/services/regexExtractService'
import {
  coerceExtractedValue,
  outputParamTypeToDataType,
  parseOutputMappingValue,
} from '@/features/regex/services/regexOutputMapping'
import { useToast } from '@/composables/shared'
import { useI18n } from 'vue-i18n'
import { ensureUniqueColumnNames, removeDerivedColumns } from './regexExtractUtils'

/**
 * 正则校验逻辑组合式函数
 *
 * 【功能说明】
 * 封装所有与正则校验相关的逻辑，
 * 供 RegexNode.vue 和其他组件使用。
 *
 * 【返回值】
 * 包含以下方法的对象：
 * - handleRegexValidate: 入口函数，触发校验
 * - handleRegexBadgeClick: 处理状态角标点击
 * - performRegexValidation: 执行校验的核心逻辑
 * - updateRegexConnectionEdges: 更新连接线状态
 * - handleRegexPatternUpdated: 模式更新后的自动校验
 */
export function useRegexValidation() {
  const { t } = useI18n()
  const store = useGraphStore()
  const { error: showError } = useToast()

  /** 用于取消上一个未完成的正则校验请求 */
  let currentAbortController: AbortController | null = null

  /**
   * 【函数：处理正则校验请求】
   *
   * 【业务目的】
   * 这是用户点击"开始校验"按钮后的入口函数。
   * 负责校验前置条件，并调用核心校验逻辑。
   *
   * 【触发流程】
   * 用户点击 RegexNode 上的"开始校验"按钮
   *   ↓
   * RegexNode.onValidateClick()
   *   ↓
   * handleRegexValidate(regexNodeId)
   *   ↓
   * performRegexValidation()
   *
   * 【前置条件检查】
   * 1. 正则节点必须存在
   * 2. 必须已连接数据源 (sourceNodeId)
   * 3. 必须存在上游 Schema 节点
   * 4. 必须指定目标列
   *
   * 【数据准备】
   * - 从 RegexNode.data 获取配置
   * - 从 store.nodes 查找关联的 Schema 节点
   * - 确定目标列名 (优先使用 sourceColumnName，否则使用第一列)
   *
   * 【异常处理】
   * - 任何条件不满足都会直接返回，不抛错
   * - 避免在用户界面上显示错误提示
   *
   * @param regexNodeId - 正则节点的唯一标识符
   */
  const handleRegexValidate = async (regexNodeId: string): Promise<void> => {
    const regexNode = store.nodes.find((node) => node.id === regexNodeId)
    if (!regexNode) {
      showError(t('regexNode.validation.nodeNotFound'))
      return
    }

    const regexData = regexNode.data as RegexNodeData

    if (!regexData.sourceNodeId) {
      showError(t('regexNode.validation.sourceNotConnected'))
      return
    }

    const upstreamNode = store.nodes.find((node) => node.id === regexData.sourceNodeId)
    if (!upstreamNode) {
      showError(t('regexNode.validation.schemaNotFound'))
      return
    }

    // 支持两种上游类型：schema（原有）和 transformOutput（新增）
    if (upstreamNode.type === 'schema') {
      const schemaData = upstreamNode.data as SchemaNodeData
      const targetColumn = regexData.sourceColumnName || schemaData.columns?.[0]?.columnName
      if (!targetColumn) {
        showError(t('regexNode.validation.columnNotFound'))
        return
      }
      await performRegexValidation(regexNode.id, upstreamNode.id, targetColumn)
    } else if (upstreamNode.type === 'transformOutput') {
      const outputData = upstreamNode.data as TransformOutputNodeData
      const columnName = regexData.sourceColumnName || outputData.columnName || 'value'
      const values = outputData.rows.map((row) => String(row[0] ?? ''))
      await performRegexValidationFromRows(regexNode.id, upstreamNode.id, columnName, values)
    } else {
      showError(t('regexNode.validation.schemaNotFound'))
    }
  }

  /**
   * 【函数：处理正则节点角标点击】
   *
   * 【业务目的】
   * 当用户点击正则节点上的错误状态角标时触发。
   * 预期行为是过滤并显示错误行的详细信息。
   *
   * 【当前实现】
   * 预留扩展，目前仅吞掉参数避免 TypeScript 报错。
   *
   * 【建议后续实现】
   * - 根据 errorCount 定位错误行
   * - 在侧边栏或弹窗中展示错误详情
   * - 提供错误行的原始数据和匹配失败的原因
   *
   * @param regexNodeId - 被点击的正则节点 ID
   */
  const handleRegexBadgeClick = (regexNodeId: string) => {
    void regexNodeId
  }

  /**
   * 【函数：执行正则表达式校验】
   *
   * 【业务目的】
   * 这是校验流程的核心函数，
   * 负责：1. 构建 API 请求参数
   *      2. 调用后端接口
   *      3. 处理校验结果
   *      4. 更新节点状态和连接线
   *      5. extract 模式下生成派生列
   *
   * 【处理流程】
   *
   * 【Phase 1: 数据准备】
   * 1. 获取 Regex 节点和 Schema 节点数据
   * 2. 定位 SourcePreview 节点（实际数据源）
   * 3. 从二维矩阵中提取目标列的值列表
   *
   * 【Phase 2: extract 模式特殊处理】
   * - 尝试更新派生列
   * - 如果成功，直接返回（已完成派生列写回）
   * - 如果失败，继续执行普通校验
   *
   * 【Phase 3: API 调用】
   * 1. 构建 RegexValidateExtractRequest
   * 2. 调用 validateAndExtractRegex()
   * 3. 处理成功/失败两种情况
   *
   * 【Phase 4: 结果处理】
   * 1. 更新节点数据 (validationStatus, 统计信息)
   * 2. 更新连接线样式 (pass/error/idle)
   *
   * 【边缘情况处理】
   * - 正则模式为空：设置状态为 idle
   * - 源节点被删除：直接返回
   * - API 调用失败：设置状态为 error
   *
   * @param regexNodeId - 正则节点 ID
   * @param schemaNodeId - Schema 节点 ID
   * @param columnName - 目标列名
   */
  const performRegexValidation = async (
    regexNodeId: string,
    schemaNodeId: string,
    columnName: string
  ) => {
    // 取消上一个未完成的请求，避免旧结果覆盖新结果
    currentAbortController?.abort()
    currentAbortController = new AbortController()

    try {
      const regexNode = store.nodes.find((node) => node.id === regexNodeId)
      if (!regexNode) return

      const schemaNode = store.nodes.find((node) => node.id === schemaNodeId)
      if (!schemaNode) return

      const regexData = regexNode.data as RegexNodeData

      if (!regexData.sourceNodeId) {
        return
      }

      const sourceSchemaNode = store.nodes.find(
        (node) => node.type === 'schema' && node.id === regexData.sourceNodeId
      )

      if (!sourceSchemaNode) {
        return
      }

      const schemaData = sourceSchemaNode.data as SchemaNodeData

      // 检查是否有数据源连接
      if (!schemaData.sourceFile) {
        store.updateNodeData(regexNode.id, {
          ...regexData,
          validationStatus: 'idle',
          validationErrors: [],
          errorCount: undefined,
          totalRows: undefined,
          matchCount: undefined,
          lastValidationTime: undefined,
        })
        updateRegexConnectionEdges(regexNode.id, 'idle')
        return
      }

      /**
       * 【extract 模式特殊处理：派生列写回】
       *
       * 【业务目的】
       * 在 extract 模式下，不仅校验数据，还要将命名捕获组的结果
       * 作为派生列写回 SourcePreview 和 Schema 节点。
       *
       * 【实现策略】
       * - 直接操作节点内存中的数据，避免重复文件 IO
       * - 派生列追加到二维矩阵的右侧
       * - 同时更新 Schema.columns 列定义
       *
       * 【处理步骤】
       * 1. 定位 SourcePreview 节点
       * 2. 提取目标列的值列表
       * 3. 调用后端 API 获取 extracted_columns
       * 4. 清理该正则之前的旧派生列
       * 5. 生成不冲突的新列名
       * 6. 将派生列追加到矩阵
       * 7. 更新 SourcePreview 和 Schema 节点
       */
      const tryUpdateExtractDerivedColumns = async (): Promise<boolean> => {
        if (regexData.matchMode !== 'extract') return false
        if (!schemaData.sourceNodeId) return false

        const sourcePreviewNode = store.nodes.find(
          (n) => n.id === schemaData.sourceNodeId && n.type === 'sourcePreview'
        )
        if (!sourcePreviewNode) return false

        const sourceData = sourcePreviewNode.data as SourcePreviewNodeData
        const tableData: unknown[][] = Array.isArray(
          (sourceData as unknown as Record<string, unknown>).data
        )
          ? ((sourceData as unknown as Record<string, unknown>).data as unknown[][])
          : []

        const headerRowIndex =
          typeof schemaData.headerRow === 'number'
            ? schemaData.headerRow
            : typeof sourceData.headerRow === 'number'
              ? sourceData.headerRow
              : 0

        const headerRow = (tableData[headerRowIndex] || []).map((v) => String(v ?? '').trim())
        if (headerRow.length === 0) return false

        const targetColumnIndex = headerRow.findIndex((name) => name === String(columnName).trim())
        if (targetColumnIndex < 0) return false

        const dataStartIndex = headerRowIndex + 1
        const values = tableData
          .slice(dataStartIndex)
          .map((row) => String((row as unknown[])?.[targetColumnIndex] ?? ''))

        const request = {
          regex_pattern: regexData.pattern,
          regex_flags: regexData.flags,
          match_mode: 'extract' as const,
          case_sensitive: regexData.caseSensitive !== false,
          values,
        }

        if (!String(request.regex_pattern || '').trim()) {
          store.updateNodeData(regexNode.id, {
            ...regexData,
            validationStatus: 'idle',
            errorCount: undefined,
            totalRows: undefined,
            matchCount: undefined,
            lastValidationTime: undefined,
          })
          updateRegexConnectionEdges(regexNode.id, 'idle')
          return true
        }

        let data: Record<string, unknown>
        try {
          data = (await validateAndExtractRegex(
            request,
            currentAbortController?.signal
          )) as unknown as Record<string, unknown>
        } catch (err: any) {
          // 请求被取消时不视为错误，静默返回
          if (err?.name === 'AbortError' || err?.message?.includes('aborted')) {
            return true
          }
          const totalRows = values.length
          store.updateNodeData(regexNode.id, {
            ...regexData,
            validationStatus: 'error',
            errorCount: totalRows,
            totalRows,
            matchCount: 0,
            lastValidationTime: new Date().toISOString(),
          })
          updateRegexConnectionEdges(regexNode.id, 'error')
          return true
        }

        const validationStatus = data.error_count === 0 ? ('pass' as const) : ('error' as const)
        store.updateNodeData(regexNode.id, {
          ...regexData,
          validationStatus,
          errorCount: Number(data.error_count),
          totalRows: Number(data.total_rows),
          matchCount: Number(data.match_count),
          lastValidationTime: new Date().toISOString(),
        })
        updateRegexConnectionEdges(regexNode.id, validationStatus)

        const groupNames: string[] = Array.isArray(data.group_names)
          ? (data.group_names as string[])
          : []
        const extractedColumns: Record<string, string[]> =
          (data.extracted_columns as Record<string, string[]> | undefined) || {}

        const outputMapping = regexData.rules?.[0]?.output || {}
        const outputEntries = Object.entries(outputMapping).filter(
          ([k]) => String(k ?? '').trim() !== ''
        )
        const hasOutputMapping = outputEntries.length > 0
        if (!hasOutputMapping && groupNames.length === 0) return true

        /**
         * 【派生列名去重机制】
         *
         * 使用模块级工具函数 removeDerivedColumns / ensureUniqueColumnNames
         */

        const { data: cleanedSourceData } = removeDerivedColumns(
          sourceData as unknown as Record<string, unknown>,
          regexNode.id,
          headerRowIndex
        )
        const cleanedMatrix: unknown[][] = Array.isArray(
          (cleanedSourceData as unknown as Record<string, unknown>).data
        )
          ? ((cleanedSourceData as unknown as Record<string, unknown>).data as unknown[][])
          : []
        const cleanedHeader = (cleanedMatrix[headerRowIndex] || []).map((v) =>
          String(v ?? '').trim()
        )
        const existingNames = new Set(cleanedHeader)
        const suffix = String(regexNode.id).slice(0, 6)

        const derivedSourceKeys = hasOutputMapping
          ? outputEntries.map(([k]) => String(k))
          : groupNames
        const derivedColumnDataTypes: DataType[] = hasOutputMapping
          ? outputEntries.map(([, v]) => {
              const binding = parseOutputMappingValue(v)
              return binding.kind === 'param' ? outputParamTypeToDataType(binding.type) : 'String'
            })
          : groupNames.map(() => 'String')

        const newColumnNames = ensureUniqueColumnNames(derivedSourceKeys, existingNames, suffix)

        const mappedValueLists = hasOutputMapping
          ? outputEntries.map(([, v]) => {
              const binding = parseOutputMappingValue(v)
              if (binding.kind === 'static') {
                return Array.from({ length: values.length }, () => binding.value)
              }
              const rawList = extractedColumns[binding.name] || []
              return Array.from({ length: values.length }, (_, idx) =>
                coerceExtractedValue(String(rawList[idx] ?? ''), binding.type)
              )
            })
          : []

        /**
         * 【矩阵列追加逻辑】
         *
         * 【处理方式】
         * - 表头行：追加新列名
         * - 数据行前：追加空字符串占位
         * - 数据行：追加实际提取的值
         *
         * 【保证一致性】
         * 所有行的列数必须一致，否则会导致数据错位
         */
        const nextMatrix = cleanedMatrix.map((row, rowIndex) => {
          const nextRow = Array.isArray(row) ? [...row] : []
          if (rowIndex === headerRowIndex) {
            nextRow.push(...newColumnNames)
            return nextRow
          }
          if (rowIndex < dataStartIndex) {
            nextRow.push(...newColumnNames.map(() => ''))
            return nextRow
          }
          const dataRowIndex = rowIndex - dataStartIndex
          if (hasOutputMapping) {
            for (let i = 0; i < mappedValueLists.length; i++) {
              const valueList = mappedValueLists[i] || []
              nextRow.push(String(valueList[dataRowIndex] ?? ''))
            }
          } else {
            for (let i = 0; i < groupNames.length; i++) {
              const groupName = groupNames[i]
              if (groupName === undefined) continue
              const valueList = extractedColumns[groupName] || []
              nextRow.push(String(valueList[dataRowIndex] ?? ''))
            }
          }
          return nextRow
        })

        const nextSourceData: Record<string, unknown> = {
          ...(cleanedSourceData as unknown as Record<string, unknown>),
          data: nextMatrix,
          actualColCount: (nextMatrix[headerRowIndex] || []).length,
          colCount: (nextMatrix[headerRowIndex] || []).length,
          totalCols: (nextMatrix[headerRowIndex] || []).length,
          previewColCount: (nextMatrix[headerRowIndex] || []).length,
          derivedColumnsByRegex: {
            ...(((cleanedSourceData as unknown as Record<string, unknown>)
              .derivedColumnsByRegex as Record<string, unknown>) || {}),
            [regexNode.id]: { columnNames: newColumnNames, groupNames: derivedSourceKeys },
          },
        }

        store.updateNodeData(sourcePreviewNode.id, nextSourceData)

        const keptColumns = (schemaData.columns || []).filter(
          (c) =>
            !String((c as unknown as Record<string, unknown>).id || '').startsWith(
              `extract-${regexNode.id}-`
            )
        )
        const existingSchemaColumnNames = new Set(
          keptColumns.map((c) => (c as unknown as Record<string, unknown>).columnName as string)
        )

        // 移除之前可能设置的 extracted_keys
        const updatedColumns = keptColumns.map((col) => {
          const { extracted_keys, ...rest } = col as unknown as Record<string, unknown>
          return rest
        })

        // 添加新的提取列，使用 Extracted 类型
        const appendedColumns = [...updatedColumns]

        const toIdToken = (raw: string) =>
          String(raw ?? '')
            .trim()
            .replace(/[^A-Za-z0-9_-]+/g, '_')
            .slice(0, 60) || 'field'

        for (let i = 0; i < newColumnNames.length; i++) {
          const sourceKey = derivedSourceKeys[i]
          const columnNameResolved = newColumnNames[i]
          if (columnNameResolved === undefined) continue
          if (existingSchemaColumnNames.has(columnNameResolved)) continue
          appendedColumns.push({
            id: columnNameResolved,
            columnName: columnNameResolved,
            dataType: derivedColumnDataTypes[i] || 'String',
            extractedConfig: {
              sourceColumn: columnName,
              extractKey: sourceKey,
              resultType: derivedColumnDataTypes[i] || 'String',
            },
            constraints: {},
            validationErrors: [],
          } as Record<string, unknown>)
        }

        store.updateNodeData(sourceSchemaNode.id, {
          ...schemaData,
          columns: appendedColumns as unknown as SchemaColumn[],
          saveState: 'draft',
          updatedAt: new Date().toISOString(),
        })

        return true
      }

      if (await tryUpdateExtractDerivedColumns()) {
        return
      }

      if (regexData.matchMode === 'extract') {
        store.updateNodeData(regexNode.id, {
          ...regexData,
          validationStatus: 'idle',
          errorCount: undefined,
          totalRows: undefined,
          matchCount: undefined,
          lastValidationTime: undefined,
        })
        updateRegexConnectionEdges(regexNode.id, 'idle')
        return
      }

      if (!schemaData.sourceNodeId) return

      const sourcePreviewNode = store.nodes.find(
        (n) => n.id === schemaData.sourceNodeId && n.type === 'sourcePreview'
      )
      if (!sourcePreviewNode) return

      const sourceData = sourcePreviewNode.data as SourcePreviewNodeData
      const tableData: unknown[][] = Array.isArray(
        (sourceData as unknown as Record<string, unknown>).data
      )
        ? ((sourceData as unknown as Record<string, unknown>).data as unknown[][])
        : []

      const headerRowIndex =
        typeof schemaData.headerRow === 'number'
          ? schemaData.headerRow
          : typeof (sourceData as unknown as Record<string, unknown>).headerRow === 'number'
            ? ((sourceData as unknown as Record<string, unknown>).headerRow as number)
            : 0

      const headerRow = (tableData[headerRowIndex] || []).map((v) => String(v ?? '').trim())
      if (headerRow.length === 0) return

      const targetColumnIndex = headerRow.findIndex((name) => name === String(columnName).trim())
      if (targetColumnIndex < 0) return

      const dataStartIndex = headerRowIndex + 1
      const values = tableData
        .slice(dataStartIndex)
        .map((row) => String((row as unknown[])?.[targetColumnIndex] ?? ''))
      if (!String(regexData.pattern || '').trim()) {
        store.updateNodeData(regexNode.id, {
          ...regexData,
          validationStatus: 'idle',
          errorCount: undefined,
          totalRows: undefined,
          matchCount: undefined,
          lastValidationTime: undefined,
        })
        updateRegexConnectionEdges(regexNode.id, 'idle')
        return
      }

      const matchMode: 'full' | 'partial' = regexData.matchMode === 'partial' ? 'partial' : 'full'
      const request = {
        regex_pattern: regexData.pattern,
        regex_flags: regexData.flags,
        match_mode: matchMode,
        case_sensitive: regexData.caseSensitive !== false,
        values,
      }

      try {
        const data = (await validateAndExtractRegex(
          request,
          currentAbortController?.signal
        )) as unknown as Record<string, unknown>
        const validationStatus = data.error_count === 0 ? ('pass' as const) : ('error' as const)
        store.updateNodeData(regexNode.id, {
          ...regexData,
          validationStatus,
          errorCount: Number(data.error_count),
          totalRows: Number(data.total_rows),
          matchCount: Number(data.match_count),
          lastValidationTime: new Date().toISOString(),
        })
        updateRegexConnectionEdges(regexNode.id, validationStatus)
      } catch (err: any) {
        // 请求被取消时不视为错误，静默返回
        if (err?.name === 'AbortError' || err?.message?.includes('aborted')) {
          return
        }
        const totalRows = values.length
        store.updateNodeData(regexNode.id, {
          ...regexData,
          validationStatus: 'error',
          errorCount: totalRows,
          totalRows,
          matchCount: 0,
          lastValidationTime: new Date().toISOString(),
        })
        updateRegexConnectionEdges(regexNode.id, 'error')
      }
    } catch (error) {
      logger.error('正则校验执行失败:', error)
    }
  }

  /**
   * 【函数：从行数据执行正则校验】
   *
   * 【业务目的】
   * 当正则节点的上游为 transformOutput 节点时，直接从其 rows 数据执行校验，
   * 无需经过 schema → sourcePreview 的间接路径。
   *
   * 【与 performRegexValidation 的区别】
   * - 跳过 extract 模式下的派生列写回（transformOutput 是临时预览节点）
   * - 跳过 schemaData.sourceNodeId → sourcePreview 的数据查找
   * - 直接接收 values 数组作为输入
   *
   * @param regexNodeId - 正则节点 ID
   * @param upstreamNodeId - 上游 transformOutput 节点 ID
   * @param columnName - 目标列名（用于显示和日志）
   * @param values - 字符串值列表
   */
  const performRegexValidationFromRows = async (
    regexNodeId: string,
    upstreamNodeId: string,
    columnName: string,
    values: string[]
  ) => {
    currentAbortController?.abort()
    currentAbortController = new AbortController()

    try {
      const regexNode = store.nodes.find((node) => node.id === regexNodeId)
      if (!regexNode) return

      const regexData = regexNode.data as RegexNodeData
      if (!String(regexData.pattern || '').trim()) {
        store.updateNodeData(regexNode.id, {
          ...regexData,
          validationStatus: 'idle',
          errorCount: undefined,
          totalRows: undefined,
          matchCount: undefined,
          lastValidationTime: undefined,
        })
        updateRegexConnectionEdges(regexNode.id, 'idle')
        return
      }

      // extract 模式：transformOutput 上游不支持派生列写回，降级为普通校验
      const matchMode: 'full' | 'partial' | 'extract' =
        regexData.matchMode === 'extract'
          ? 'full'
          : regexData.matchMode === 'partial'
            ? 'partial'
            : 'full'

      const request = {
        regex_pattern: regexData.pattern,
        regex_flags: regexData.flags,
        match_mode: matchMode,
        case_sensitive: regexData.caseSensitive !== false,
        values,
      }

      try {
        const data = (await validateAndExtractRegex(
          request,
          currentAbortController?.signal
        )) as unknown as Record<string, unknown>
        const validationStatus = data.error_count === 0 ? ('pass' as const) : ('error' as const)
        store.updateNodeData(regexNode.id, {
          ...regexData,
          validationStatus,
          errorCount: Number(data.error_count),
          totalRows: Number(data.total_rows),
          matchCount: Number(data.match_count),
          lastValidationTime: new Date().toISOString(),
        })
        updateRegexConnectionEdges(regexNode.id, validationStatus)
      } catch (err: any) {
        if (err?.name === 'AbortError' || err?.message?.includes('aborted')) {
          return
        }
        const totalRows = values.length
        store.updateNodeData(regexNode.id, {
          ...regexData,
          validationStatus: 'error',
          errorCount: totalRows,
          totalRows,
          matchCount: 0,
          lastValidationTime: new Date().toISOString(),
        })
        updateRegexConnectionEdges(regexNode.id, 'error')
      }
    } catch (error) {
      logger.error('正则校验执行失败 (from rows):', error)
    }
  }

  /**
   * 【函数：更新正则校验连接线的状态】
   *
   * 【业务目的】
   * 根据节点的校验状态，同步更新连接线的样式。
   * 让用户直观地看到数据流经正则节点后的状态。
   *
   * 【样式映射】
   * - validationStatus='idle': 灰色普通样式
   * - validationStatus='pass': 绿色边框
   * - validationStatus='error': 红色边框
   *
   【实现逻辑】
   * 1. 遍历所有边，筛选出目标为该正则节点的边
   * 2. 筛选条件：target === regexNodeId && label === 'Regex Validation'
   * 3. 移除旧的 validation-* 样式类
   * 4. 添加新的 validation-status 类
   *
   * 【注意事项】
   * 只更新标记为 'Regex Validation' 的边，
   * 避免影响其他类型的连接线。
   *
   * @param regexNodeId - 正则节点 ID
   * @param validationStatus - 校验状态
   */
  const updateRegexConnectionEdges = (
    regexNodeId: string,
    validationStatus: 'pass' | 'error' | 'idle'
  ) => {
    try {
      store.edges = store.edges.map((edge) => {
        if (edge.target === regexNodeId && edge.label === 'Regex Validation') {
          let className = ''
          if (typeof edge.class === 'string') {
            className = edge.class
              .replace(/validation-pass/g, '')
              .replace(/validation-error/g, '')
              .replace(/validation-idle/g, '')
              .trim()
          }

          const updatedClassName =
            validationStatus === 'idle'
              ? className
              : `${className} validation-${validationStatus}`.trim()

          return {
            ...edge,
            class: updatedClassName || undefined,
          }
        }
        return edge
      })
    } catch (error) {
      logger.error('更新连接线状态失败:', error)
    }
  }

  /**
   * 【函数：处理正则表达式模式更新事件】
   *
   * 【业务目的】
   * 当用户在正则设计器中更新模式后，自动触发重新校验。
   *
   * 【触发方式】
   * 通过 CustomEvent 监听 regexPatternUpdated 事件
   *
   * 【前置条件】
   * - 正则节点必须已连接数据源
   * - 必须指定目标列
   *
   * @param event - CustomEvent 事件对象
   */
  const handleRegexPatternUpdated = async (detail: { nodeId: string; reason: string }) => {
    const { nodeId } = detail

    const regexNode = store.nodes.find((n) => n.id === nodeId && n.type === 'regex')
    if (!regexNode) {
      return
    }

    const regexData = regexNode.data as RegexNodeData

    if (!regexData.sourceNodeId) {
      return
    }

    const sourceNode = store.nodes.find(
      (n) => n.id === regexData.sourceNodeId && n.type === 'schema'
    )
    if (!sourceNode) {
      return
    }

    const targetColumn = regexData.sourceColumnName
    if (!targetColumn) {
      return
    }

    await performRegexValidation(regexNode.id, sourceNode.id, targetColumn)
  }

  return {
    handleRegexValidate,
    handleRegexBadgeClick,
    performRegexValidation,
    updateRegexConnectionEdges,
    handleRegexPatternUpdated,
  }
}
