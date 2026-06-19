/**
 * @file useScripted.ts
 * @description 脚本约束组合式函数
 *
 * 功能概述:
 * - 提供脚本约束节点的业务逻辑封装
 * - 支持自定义 Python 脚本进行数据校验
 * - 集成脚本安全设置检查
 * - 通过后端 API 执行脚本校验
 *
 * 架构设计:
 * - 基于 useConstraintBase 基础约束功能扩展
 * - 使用 graphStore 管理节点状态和图数据
 * - 使用 settingsStore 获取脚本安全设置
 * - 调用 validationApi.validateScripted 执行后端校验
 *
 * 注：IndexedDB 模式已在 2026年3月移除
 */

import { logger } from '@/core/utils/logger'
import { useConstraintBase } from './useConstraintBase'
import { useGraphStore } from '@/stores/graphStore'
import { validateScripted } from '@/api/validationApi'
import { tryInlineValidation } from '@/composables/nodes/constraints/tryInlineValidation'
import { useSettingsStore } from '@/stores/settingsStore'
import { findJsonSchemaColumnById } from '@/utils/nodes/json/columnFinder'
import type { ScriptedConstraintNodeData } from '@/types/constraints'

/**
 * 脚本约束节点数据
 * @typedef {Object} ScriptedConstraintNodeData
 * @property {string} id - 节点唯一标识
 * @property {string} script - Python 脚本代码
 * @property {string} [configName] - 脚本配置名称
 * @property {Object} [sourceRef] - 源数据引用
 * @property {string} sourceRef.nodeId - 源 Schema 节点 ID
 * @property {string} sourceRef.columnId - 源列 ID
 * @property {string} [column] - 目标列名称（后备字段）
 * @property {string} [validationStatus] - 校验状态: 'idle' | 'pass' | 'error' | 'missing'
 * @property {string[]} [validationErrors] - 校验错误信息列表
 * @property {Object} [lastValidation] - 最后一次校验结果
 * @property {number} lastValidation.totalRows - 总行数
 * @property {number} lastValidation.errorCount - 错误行数
 * @property {number} lastValidation.matchCount - 通过行数
 */

/**
 * 校验结果对象
 * @typedef {Object} ValidationResult
 * @property {number} errorCount - 错误行数
 * @property {number} totalRows - 总行数
 * @property {Array<{row: number; value: unknown; message: string | undefined}>} errors - 错误详情列表
 */

/**
 * 脚本约束组合式函数
 *
 * 提供脚本约束节点的完整业务逻辑，包括：
 * - 脚本安全设置检查
 * - 源节点和列的解析
 * - 后端脚本校验执行
 * - 错误格式化和结果展示
 *
 * @param {Object} props - 组件属性
 * @param {string} props.id - 节点唯一标识
 * @param {ScriptedConstraintNodeData} props.data - 节点数据
 * @param {any} emit - Vue 事件发射器
 * @returns {Object} 脚本约束功能对象
 * @returns {Function} returns.performValidation - 执行脚本校验
 * @returns {Function} returns.formatScriptedErrors - 格式化校验错误
 * @returns {Function} returns.updateScript - 更新脚本内容
 * @returns {Function} returns.isScriptEnabled - 检查脚本是否启用
 * @returns {Function} returns.getScriptWarning - 获取脚本警告信息
 * @returns {Function} returns.getAvailableBuiltins - 获取可用的内置函数列表
 * @returns {Function} returns.getAvailableVariables - 获取可用的变量列表
 * @returns {Object} returns...base - 基础约束功能（来自 useConstraintBase）
 */
export function UseScripted(props: { id: string; data: ScriptedConstraintNodeData }, emit: any) {
  const base = useConstraintBase(props, emit)
  const store = useGraphStore()
  const settingsStore = useSettingsStore()

  /**
   * 检查脚本功能是否已启用
   *
   * 根据 settingsStore 中的配置判断脚本功能是否可用，
   * 考虑全局启用开关和管理员权限设置。
   *
   * @returns {boolean} 脚本功能是否启用
   */
  const isScriptEnabled = (): boolean => {
    return settingsStore.isScriptEnabled
  }

  /**
   * 获取脚本功能警告信息
   *
   * 当脚本功能未启用或需要管理员权限时，返回相应的警告提示信息，
   * 用于在用户界面中显示禁用原因和解决指引。
   *
   * @returns {string} 警告信息，如果脚本可用则返回空字符串
   */
  const getScriptWarning = (): string => {
    if (!settingsStore.isScriptEnabled) {
      return '脚本功能未在设置中启用。请前往设置 → 脚本安全，开启脚本功能。'
    }
    return ''
  }

  /**
   * 获取 Schema 列的名称
   *
   * 根据 Schema 节点 ID 和列 ID，从图中查找对应的列名称。
   *
   * @param {string} schemaNodeId - Schema 节点 ID
   * @param {string} columnId - 列 ID
   * @returns {string | null} 列名称，如果找不到则返回 null
   */
  const getSchemaColumnName = (schemaNodeId: string, columnId: string): string | null => {
    const node = store.nodes.find((n) => n.id === schemaNodeId)
    if (!node || (node.type !== 'schema' && node.type !== 'jsonSchema')) return null

    if (node.type === 'jsonSchema') {
      const columns = ((node.data as unknown as Record<string, unknown>).columns as import('@/types/graph').JsonSchemaColumn[]) || []
      const found = findJsonSchemaColumnById(columns, columnId)
      return found?.column.columnName || null
    }

    const columns = (node.data as unknown as Record<string, unknown>).columns || []
    const col = (columns as Array<{ id: string; columnName: string }>).find(
      (c) => c.id === columnId
    )
    return col?.columnName || null
  }

  /**
   * 执行脚本校验
   *
   * 完整的脚本校验流程：
   * 1. 检查脚本功能是否启用
   * 2. 验证脚本内容是否配置
   * 3. 解析源节点和数据源
   * 4. 调用后端 API 执行脚本校验
   * 5. 处理校验结果并更新节点状态
   *
   * 支持的脚本变量:
   * - value: 当前单元格的值
   * - pd: pandas 库
   * - re: 正则表达式库
   * - tables: 所有表数据
   *
   * @async
   * @returns {Promise<ValidationResult>} 校验结果对象
   * @returns {number} return.errorCount - 错误行数
   * @returns {number} return.totalRows - 总行数
   * @returns {Array} return.errors - 错误详情列表
   */
  const performValidation = async () => {
    logger.debug('🔄 执行脚本校验:', props.id)

    const emptyResult = {
      errorCount: 0,
      totalRows: 0,
      errors: [] as Array<{ row: number; value: unknown; message: string | undefined }>,
    }

    // 检查脚本功能是否启用
    if (!isScriptEnabled()) {
      store.updateNodeData(props.id, {
        validationStatus: 'error',
        validationErrors: ['脚本功能未启用，请先在设置中启用脚本功能'],
        lastValidation: undefined,
      })
      return emptyResult
    }

    // 检查脚本内容是否配置
    if (!props.data.script || props.data.script.trim() === '') {
      store.updateNodeData(props.id, {
        validationStatus: 'idle',
        validationErrors: ['请先配置脚本后再进行校验'],
        lastValidation: undefined,
      })
      return emptyResult
    }

    try {
      // 获取源节点引用
      const sourceNodeId = props.data.sourceRef?.nodeId
      if (!sourceNodeId) {
        store.updateNodeData(props.id, {
          validationStatus: 'idle',
          validationErrors: [],
          lastValidation: undefined,
        })
        return emptyResult
      }

      // 查找源节点
      const sourceNode = store.nodes.find((n) => n.id === sourceNodeId)
      if (!sourceNode) {
        store.updateNodeData(props.id, {
          validationStatus: 'missing',
          validationErrors: ['找不到源节点，请重新连接'],
          lastValidation: undefined,
        })
        return emptyResult
      }

      // 验证源节点类型
      if (
        sourceNode.type !== 'schema' &&
        sourceNode.type !== 'jsonSchema' &&
        sourceNode.type !== 'manualData' &&
        sourceNode.type !== 'transformOutput'
      ) {
        store.updateNodeData(props.id, {
          validationStatus: 'missing',
          validationErrors: ['脚本约束的源必须是 Schema 节点或数据节点'],
          lastValidation: undefined,
        })
        return emptyResult
      }

      if (sourceNode.type === 'manualData' || sourceNode.type === 'transformOutput') {
        await tryInlineValidation(store, { nodeId: sourceNode.id, columnId: '0' }, props.id)
        return emptyResult
      }

      const sourceSchemaData = sourceNode.data as unknown as Record<string, unknown>

      // 检查数据源是否已连接
      if (!sourceSchemaData.sourceFile) {
        return emptyResult
      }

      const sourceFilePath = sourceSchemaData.sourceFilePath
      const localPath = sourceSchemaData.localPath
      const sheetName = sourceSchemaData.sheetName
      const headerRow = sourceSchemaData.headerRow

      if (!sourceFilePath) {
        return emptyResult
      }

      const actualFilePath = localPath || sourceFilePath

      // 解析源列名称
      const sourceColumnName = props.data.sourceRef
        ? getSchemaColumnName(props.data.sourceRef.nodeId, props.data.sourceRef.columnId)
        : props.data.column

      if (!sourceColumnName) {
        store.updateNodeData(props.id, {
          validationStatus: 'missing',
          validationErrors: ['源列不存在或已删除，无法执行脚本校验'],
          lastValidation: undefined,
        })
        return emptyResult
      }

      // 构建校验配置
      const validationConfig = {
        script: props.data.script,
        script_name: props.data.configName || 'custom_script',
      }

      // 调用后端 API 执行脚本校验
      const response = await validateScripted({
        validation_type: 'scripted',
        target_column_name: sourceColumnName,
        source_file_path: String(actualFilePath),
        sheet_name: sheetName as string,
        header_row: headerRow as number,
        validation_config: validationConfig,
        allow_unsafe_eval: true,
      })

      // 处理校验错误
      if (!response.success || !response.data) {
        const status = response.error?.includes('PermissionError') ? 'missing' : 'error'
        const errorMessage = response.error || '脚本校验失败'
        store.updateNodeData(props.id, {
          validationStatus: status,
          validationErrors: [errorMessage],
          lastValidation: undefined,
        })
        return emptyResult
      }

      // 处理校验结果
      const errorRows = response.data.error_rows || []
      const errorCount = errorRows.length
      const totalRows = response.data.total_rows || 0
      const matchCount = Math.max(0, totalRows - errorCount)

      const formattedErrors = errorRows.map((err: any) => ({
        row: err.row_index,
        value: err.cell_value,
        message: err.error_message,
      }))

      // 更新节点数据
      store.updateNodeData(props.id, {
        validationStatus: errorCount > 0 ? 'error' : 'pass',
        validationErrors: formatScriptedErrors(formattedErrors),
        lastValidation: {
          totalRows,
          errorCount,
          matchCount,
        },
        scriptName: props.data.configName,
      })

      return {
        errorCount,
        totalRows,
        errors: formattedErrors,
      }
    } catch (error) {
      // 处理执行异常
      const message = error instanceof Error ? error.message : String(error)
      store.updateNodeData(props.id, {
        validationStatus: 'error',
        validationErrors: [message],
        lastValidation: undefined,
      })
      return emptyResult
    }
  }

  /**
   * 格式化脚本校验错误
   *
   * 将后端返回的错误数组格式化为用户友好的字符串数组，
   * 包含行号和错误信息，用于在节点详情中展示。
   *
   * @param {Array<{row: number; value: unknown; message?: string}>} errors - 原始错误数组
   * @returns {string[]} 格式化后的错误信息数组
   */
  const formatScriptedErrors = (errors: any[]): string[] => {
    return errors.map((err) => {
      const rowNumber = Number(err.row)
      const valueText = err.value === null || err.value === undefined ? '' : String(err.value)
      const fallbackMessage = `脚本校验失败`
      return `第 ${Number.isFinite(rowNumber) ? rowNumber + 1 : '-'} 行: ${err.message || fallbackMessage}`
    })
  }

  /**
   * 更新脚本内容
   *
   * 更新节点的脚本代码和配置名称，并重置校验状态为 idle。
   *
   * @param {string} script - 新的 Python 脚本代码
   * @param {string} [scriptName] - 脚本配置名称（可选）
   * @returns {void}
   */
  const updateScript = (script: string, scriptName?: string): void => {
    store.updateNodeData(props.id, {
      script,
      configName: scriptName,
      validationStatus: 'idle',
      validationErrors: [],
    })
  }

  /**
   * 获取可用的内置函数列表
   *
   * 返回脚本环境中允许使用的 Python 内置函数名称列表，
   * 用于在前端编辑器中显示自动补全提示。
   *
   * @returns {string[]} 内置函数名称数组
   */
  const getAvailableBuiltins = (): string[] => {
    return [
      'len',
      'sum',
      'max',
      'min',
      'round',
      'abs',
      'any',
      'all',
      'int',
      'str',
      'float',
      'bool',
      'list',
      'dict',
      'set',
    ]
  }

  /**
   * 获取可用的变量列表
   *
   * 返回脚本执行时可用的预定义变量名称列表：
   * - value: 当前单元格的值
   * - pd: pandas 数据分析库
   * - re: 正则表达式库
   * - tables: 所有表数据字典
   *
   * @returns {string[]} 变量名称数组
   */
  const getAvailableVariables = (): string[] => {
    return ['value', 'pd', 're', 'tables']
  }

  return {
    ...base,
    performValidation,
    formatScriptedErrors,
    updateScript,
    isScriptEnabled,
    getScriptWarning,
    getAvailableBuiltins,
    getAvailableVariables,
  }
}

export default UseScripted
