/**
 * @file useToolboxCreators.ts
 * @description 工具箱节点创建组合式函数
 *
 * 功能职责：
 * - 封装工具箱各类型节点的创建逻辑
 * - 统一错误处理和用户提示
 */

import { logger } from '@/core/utils/logger'
import { useI18n } from 'vue-i18n'
import { useGraphStore } from '@/stores/graphStore'
import type { ConstraintKind } from '@/services/constraints/types'
import type { TransformTypeV2 } from '@/types/projectV2'

export function useToolboxCreators() {
  const { t } = useI18n()
  const store = useGraphStore()

  /**
   * 创建 Project Root 节点
   */
  const createProjectRoot = (): void => {
    try {
      const position = { x: 100, y: 100 }
      store.createProjectRootNode(position)
    } catch (error) {
      logger.error('创建Project Root节点失败:', error)
      alert(t('messages.common.createNodeFailed'))
    }
  }

  /**
   * 创建 Table Schema 节点
   */
  const createTableSchema = (): void => {
    try {
      const position = { x: 200, y: 100 }
      store.createSchemaNode(position, t('messages.canvas.newTable'))
    } catch (error) {
      logger.error('创建Schema节点失败:', error)
      alert(t('messages.common.createNodeFailed'))
    }
  }

  /**
   * 创建 JSON Schema 节点
   */
  const createJsonSchema = (): void => {
    try {
      const position = { x: 200, y: 100 }
      store.createJsonSchemaNode(position, t('messages.canvas.newTable'))
    } catch (error) {
      logger.error('创建JSON Schema节点失败:', error)
      alert(t('messages.common.createNodeFailed'))
    }
  }

  /**
   * 创建 Regex Pattern 节点
   */
  const createRegexPattern = (): void => {
    try {
      const position = { x: 300, y: 150 }
      store.createRegexNode(position)
    } catch (error) {
      logger.error('创建正则表达式节点失败:', error)
      alert(t('messages.common.createNodeFailed'))
    }
  }

  /**
   * 创建约束节点
   * @param constraintType 约束类型
   */
  const createConstraintNode = (constraintType: string): void => {
    try {
      const position = { x: 400, y: 200 }
      store.createConstraintNode(position, constraintType as ConstraintKind)
    } catch (error) {
      logger.error('创建约束节点失败:', error)
      alert(t('messages.common.createNodeFailed'))
    }
  }

  /**
   * 创建 Transform 节点
   * @param transformType 转换类型
   */
  const createTransform = (transformType: TransformTypeV2): void => {
    try {
      const position = { x: 400, y: 200 }
      store.createTransformNode(position, transformType)
    } catch (error) {
      logger.error('创建Transform节点失败:', error)
      alert(t('messages.common.createNodeFailed'))
    }
  }

  /**
   * 创建手动数据节点
   */
  const createManualData = (): void => {
    try {
      const position = { x: 200, y: 200 }
      store.createManualDataNode(position)
    } catch (error) {
      logger.error('创建手动数据节点失败:', error)
      alert(t('messages.common.createNodeFailed'))
    }
  }

  return {
    createProjectRoot,
    createTableSchema,
    createJsonSchema,
    createRegexPattern,
    createConstraintNode,
    createTransform,
    createManualData,
  }
}
