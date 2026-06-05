/**
 * @file useSchemaEvents.ts
 * @description Schema节点事件处理
 * 处理 Schema 节点相关的全局事件，包括保存、表头变更等
 * 提供事件监听和自定义事件派发功能
 */

import { logger } from '@/core/utils/logger'
import { eventBus } from '@/core/eventBus'
import { useI18n } from 'vue-i18n'
import { useGraphStore } from '@/stores/graphStore'
import type { SchemaNodeData } from '../types'
import { useToast } from '@/composables/shared/useToast'
import { inferDataType } from '@/utils/nodes/schema/typeInference'

/**
 * Schema节点事件处理
 * 管理 Schema 节点的事件监听和处理逻辑
 * 包括节点保存、表头变更等事件的处理
 *
 * @param props - 组件属性，包含节点 ID 和数据
 * @param emit - Vue 的 emit 函数，用于向上层组件通知事件
 * @returns 包含事件处理方法的对象
 */
export function useSchemaEvents(props: { id: string; data: SchemaNodeData }, emit: any) {
  // 国际化支持
  const { t } = useI18n()
  // 获取全局图存储，用于访问和修改节点数据
  const store = useGraphStore()
  // 统一 Toast 消息工具
  const toast = useToast()
  const showError = toast.error

  // 处理节点保存事件
  // 当用户触发 Schema 节点保存时调用
  // 验证参数有效性，调用 store 保存节点数据
  // 保存完成后派发自定义事件通知完成状态
  //
  // @param data - 保存数据对象，包含 nodeId 和 nodeData
  const handleNodeSave = async (data: { nodeId: string; nodeData: any }) => {
    // 记录接收到保存事件的日志
    logger.debug('📥 接收到schema-node-save事件:', data)

    // 验证 data 是否存在
    if (!data) {
      logger.warn('保存事件data为空，跳过处理')
      return
    }

    // 解构获取节点 ID 和节点数据
    const { nodeId, nodeData } = data

    // 验证必要参数是否存在
    if (!nodeId || !nodeData) {
      logger.warn('保存事件缺少必要参数，跳过处理:', data)
      return
    }

    // 记录开始保存的日志
    logger.debug('🔄 开始保存Schema节点:', nodeId)

    try {
      // 调用 store 方法保存 Schema 节点
      const result = await store.saveSchemaNode(nodeId)

      if (result === true) {
        // 记录保存成功的日志
        logger.debug('✅ Schema节点保存成功:', result)

        // 显示成功提示
        // 注意：store.saveSchemaNode 内部已经显示了 toastSuccess，这里可能不需要重复显示
        // showToastMessage('Schema节点保存成功', 'success');

        // 查找对应的 DOM 元素，派发保存完成事件
        eventBus.emit('schema-node-save-complete', {
          nodeId: nodeId,
          success: true,
        })
      } else if (result === 'cancelled') {
        // 保存被取消
        logger.debug('🚫 Schema节点保存已取消')

        eventBus.emit('schema-node-save-complete', {
          nodeId: nodeId,
          success: false,
          cancelled: true,
        })
      } else {
        // 保存失败（store 内部已处理错误提示）
        logger.debug('❌ Schema节点保存失败')

        // 查找对应的 DOM 元素，派发保存完成事件（success: false）
        eventBus.emit('schema-node-save-complete', {
          nodeId: nodeId,
          success: false,
        })
      }
    } catch (error) {
      // 捕获并记录错误
      logger.error('保存Schema节点失败:', error)

      // 显示失败提示
      showError('保存失败：' + (error as Error).message)

      // 查找对应的 DOM 元素，派发保存失败事件
      eventBus.emit('schema-node-save-complete', {
        nodeId: nodeId,
        success: false,
        error: String(error),
      })
    }
  }

  /**
   * 生成列定义并推断数据类型
   * 根据表头数据生成列定义，根据数据样本推断列的数据类型
   *
   * 处理流程：
   * 1. 验证表头数据有效性
   * 2. 遍历表头数据，为每个列生成定义
   * 3. 根据数据样本推断数据类型
   * 4. 更新 Schema 节点的列定义
   *
   * @param headerData - 表头数据数组
   * @param schemaNode - Schema 节点对象
   * @param tableData - 完整表格数据，用于类型推断（可选）
   * @param headerRowIndex - 表头行索引（可选）
   */
  const generateColumnsWithTypeInference = (
    headerData: any[],
    schemaNode: any,
    tableData?: any[][],
    headerRowIndex?: number
  ) => {
    // 检查表头数据是否有效
    if (!headerData || headerData.length === 0) {
      logger.warn('表头数据为空')
      return
    }

    // 遍历表头数据，为每个单元格生成列定义
    const columns = headerData.map((header: any, index: number) => {
      // 获取表头文本并去除首尾空白
      const headerText = String(header).trim()
      // 列名：使用表头文本，若为空则使用默认名称
      const columnName = headerText || `column_${index + 1}`

      // 初始化数据类型为字符串
      let dataType: string = 'String'

      // 如果提供了表格数据和表头行索引，尝试推断数据类型
      if (tableData && typeof headerRowIndex === 'number') {
        // 确保数据行存在
        if (headerRowIndex + 1 < tableData.length) {
          // 获取表头行的下一行数据作为样本
          const sampleData = tableData[headerRowIndex + 1]
          // 检查该列是否存在数据
          if (sampleData && sampleData[index] !== undefined) {
            // 使用统一的类型推断工具
            dataType = inferDataType(sampleData[index])
          }
        }
      }

      // 返回生成的列定义对象
      return {
        id: columnName,
        columnName: columnName,
        dataType: dataType,
        expressionType: 'none',
        constraints: {},
        validationErrors: [],
      }
    })

    // 更新 Schema 节点的列定义
    store.updateNodeData(schemaNode.id, { ...schemaNode.data, columns: columns })
  }

  // 返回组合式函数提供的所有方法
  return {
    handleNodeSave,
    generateColumnsWithTypeInference,
  }
}
