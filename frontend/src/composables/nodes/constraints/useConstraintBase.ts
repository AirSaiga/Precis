/**
 * @file useConstraintBase.ts
 * @description 约束基础逻辑
 * 定义所有约束类型节点的共享逻辑和通用接口
 * 负责约束的连接建立、验证流程和结果处理等核心功能
 */

import { logger } from '@/core/utils/logger'
import { reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ConstraintNodeData, SchemaNodeSourceInfo } from '../types'

/**
 * 约束基础逻辑
 * 为所有约束类型节点提供通用的功能实现
 * 包括连接管理、验证流程、状态追踪等
 * @param props - 组件属性，包含节点 ID 和数据
 * @param emit - Vue 的 emit 函数，用于向上层组件通知事件
 * @returns 包含约束状态、连接信息和操作方法的对象
 */
export function useConstraintBase(props: { id: string; data: ConstraintNodeData }, emit: any) {
  // 国际化支持
  const { t } = useI18n()

  // 约束验证状态，使用 reactive 确保响应式
  // validationStatus: 验证状态，idle=空闲/未验证，pass=通过，error=失败
  // errorCount: 错误数量
  // lastValidationTime: 最后验证时间
  const constraintState = reactive({
    validationStatus: 'idle' as 'idle' | 'pass' | 'error',
    errorCount: 0,
    lastValidationTime: '',
  })

  // 存储连接的 Schema 节点信息，用于验证时获取数据源
  // sourceFilePath: 数据源文件路径
  // sheetName: 工作表名称
  // headerRow: 表头行号
  const sourceInfo = ref<SchemaNodeSourceInfo | null>(null)

  /**
   * 处理 Schema 连接
   * 当约束节点与 Schema 节点的列端口建立连接时调用
   * 记录连接信息并通知父组件
   * @param schemaNode - Schema 节点对象
   * @param columnId - 被连接的列 ID
   */
  const handleSchemaConnection = (schemaNode: any, columnId: string) => {
    // 记录连接开始的日志
    logger.debug('🔄 Schema连接:', schemaNode.id, columnId)

    // 从 Schema 节点的 columns 数组中查找被连接的列
    const column = schemaNode.data.columns.find((col: any) => col.id === columnId)

    // 如果列不存在，记录错误并返回
    if (!column) {
      logger.error('列不存在:', columnId)
      return
    }

    // 记录 Schema 节点的源信息，用于后续验证
    // sourceMode 和 localPath 用于判断数据源类型，以便选择正确的 API 端点
    // sourceFile 用于判断源表是否显式连接了数据源（区分残留路径）
    sourceInfo.value = {
      sourceFilePath: schemaNode.data.sourceFilePath || '',
      sourceFile: schemaNode.data.sourceFile, // 同步显式连接标识
      sheetName: schemaNode.data.sheetName,
      headerRow: schemaNode.data.headerRow,
      sourceMode: schemaNode.data.sourceMode, // localfile
      localPath: schemaNode.data.localPath, // 本地文件路径（Electron 环境专用）
    }

    // 向上层组件通知连接建立事件
    emit('schemaConnected', {
      nodeId: props.id,
      schemaNodeId: schemaNode.id,
      columnId: columnId,
      columnName: column.columnName,
    })

    // 记录连接成功的日志
    logger.debug('✅ Schema连接成功:', column.columnName)
  }

  /**
   * 断开 Schema 连接
   * 当用户断开约束节点与 Schema 节点的连接时调用
   * 清除连接信息并通知父组件
   * @returns 无返回值
   */
  const disconnectSchema = () => {
    // 记录断开连接的日志
    logger.debug('🔄 断开Schema连接')

    // 清除源信息
    sourceInfo.value = null

    // 向上层组件通知连接断开事件
    emit('schemaDisconnected', {
      nodeId: props.id,
    })

    // 记录断开完成的日志
    logger.debug('✅ Schema连接已断开')
  }

  /**
   * 开始验证
   * 触发约束验证流程，执行实际的验证逻辑
   * 需要先检查是否已连接到 Schema 节点
   * @returns 验证结果 Promise
   */
  const startValidation = async () => {
    // 检查是否已连接 Schema 节点
    if (!sourceInfo.value) {
      logger.warn('未连接Schema，无法验证')
      return
    }

    // 记录开始验证的日志
    logger.debug('🔄 开始验证:', props.id)

    try {
      // 将验证状态设置为空闲
      constraintState.validationStatus = 'idle'

      // 调用 performValidation 执行实际验证（由子类实现）
      const result = await performValidation()

      // 处理验证结果
      handleValidationResult(result)

      // 返回验证结果
      return result
    } catch (error) {
      // 捕获并记录错误
      logger.error('验证失败:', error)
      // 将验证状态设置为错误
      constraintState.validationStatus = 'error'
      // 重新抛出错误，让调用者处理
      throw error
    }
  }

  /**
   * 执行验证（由子类实现）
   * 这是一个抽象方法，由具体的约束类型子类实现
   * 子类需要根据约束类型实现具体的验证逻辑
   * @returns 验证结果 Promise
   */
  const performValidation = async () => {
    // 抛出错误，提示子类必须实现此方法
    throw new Error('子类必须实现 performValidation 方法')
  }

  /**
   * 处理验证结果
   * 更新约束状态并通知父组件
   * @param result - 验证结果对象
   */
  const handleValidationResult = (result: any) => {
    // 记录验证结果的日志
    logger.debug('📊 验证结果:', result)

    // 更新约束状态
    constraintState.errorCount = result.errorCount || 0
    // 根据错误数量确定验证状态
    constraintState.validationStatus = result.errorCount > 0 ? 'error' : 'pass'
    // 记录最后验证时间
    constraintState.lastValidationTime = new Date().toISOString()

    // 向上层组件通知验证完成事件
    emit('validationCompleted', {
      nodeId: props.id,
      result: result,
    })

    // 创建一个自定义事件，通知整个文档验证已完成
    const event = new CustomEvent('constraintValidationCompleted', {
      detail: {
        nodeId: props.id,
        result: result,
      },
    })
    // 派发事件到文档
    document.dispatchEvent(event)
  }

  /**
   * 显示验证错误
   * 将验证错误列表发送给父组件进行展示
   * @param errors - 验证错误数组
   * @returns 无返回值
   */
  const showValidationErrors = (errors: any[]) => {
    // 记录验证错误的日志
    logger.debug('❌ 验证错误:', errors)

    // 向上层组件通知验证错误事件
    emit('validationErrors', {
      nodeId: props.id,
      errors: errors,
    })
  }

  /**
   * 更新配置
   * 将配置变更通知父组件
   * @param config - 配置对象，包含要更新的配置项
   * @returns 无返回值
   */
  const updateConfig = (config: Record<string, unknown>) => {
    // 记录更新配置的日志
    logger.debug('🔄 更新配置:', config)

    // 向上层组件通知配置更新事件
    emit('configUpdated', {
      nodeId: props.id,
      config: config,
    })
  }

  // 返回状态和方法，供外部组件使用
  return {
    constraintState,
    sourceInfo,
    handleSchemaConnection,
    disconnectSchema,
    startValidation,
    performValidation,
    handleValidationResult,
    showValidationErrors,
    updateConfig,
  }
}
