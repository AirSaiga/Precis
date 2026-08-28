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
import { toastError } from '@/core/toast'
import { getViewportCenterInFlowCoords } from '@/services/canvas/vueFlowApi'
import { resolveSpawnPosition } from '@/services/canvas/spawnPosition'
import type { ConstraintKind } from '@/services/constraints/types'
import type { TransformTypeV2 } from '@/types/projectV2'

export function useToolboxCreators() {
  const { t } = useI18n()
  const store = useGraphStore()

  /**
   * 计算新节点落点：优先取当前视口中心附近的不重叠位置。
   *
   * 历史上这里对每类节点使用固定坐标（schema 恒为 {200,100} 等），
   * 连续创建会精确堆叠在同一位置，新节点被旧节点完全遮挡，
   * 用户会误以为点击创建无效（见 2026-08-28 视觉测试 D4）。
   */
  const resolveNodeSpawnPosition = (): { x: number; y: number } => {
    return resolveSpawnPosition({
      viewportCenter: getViewportCenterInFlowCoords(),
      occupants: store.nodes
        // 折叠模板的子节点以 hidden:true 隐藏，不占视觉空间，不参与落点避让
        .filter((n) => !n.hidden)
        .map((n) => ({
          position: n.position,
          // Vue Flow 的 width/height 允许 string|number|函数，只取实测数值
          width: typeof n.width === 'number' ? n.width : undefined,
          height: typeof n.height === 'number' ? n.height : undefined,
        })),
    })
  }

  /**
   * 创建 Project Root 节点
   */
  const createProjectRoot = (): void => {
    try {
      store.createProjectRootNode(resolveNodeSpawnPosition())
    } catch (error) {
      logger.error('创建Project Root节点失败:', error)
      toastError(t('messages.common.createNodeFailed'))
    }
  }

  /**
   * 创建 Table Schema 节点
   */
  const createTableSchema = (): void => {
    try {
      store.createSchemaNode(resolveNodeSpawnPosition(), t('messages.canvas.newTable'))
    } catch (error) {
      logger.error('创建Schema节点失败:', error)
      toastError(t('messages.common.createNodeFailed'))
    }
  }

  /**
   * 创建 JSON Schema 节点
   */
  const createJsonSchema = (): void => {
    try {
      store.createJsonSchemaNode(resolveNodeSpawnPosition(), t('messages.canvas.newTable'))
    } catch (error) {
      logger.error('创建JSON Schema节点失败:', error)
      toastError(t('messages.common.createNodeFailed'))
    }
  }

  /**
   * 创建 Regex Pattern 节点
   */
  const createRegexPattern = (): void => {
    try {
      store.createRegexNode(resolveNodeSpawnPosition())
    } catch (error) {
      logger.error('创建正则表达式节点失败:', error)
      toastError(t('messages.common.createNodeFailed'))
    }
  }

  /**
   * 创建 Regex Extract 节点
   */
  const createRegexExtract = (): void => {
    try {
      store.createRegexExtractNode(resolveNodeSpawnPosition())
    } catch (error) {
      logger.error('创建正则提取节点失败:', error)
      toastError(t('messages.common.createNodeFailed'))
    }
  }

  /**
   * 创建约束节点
   * @param constraintType 约束类型
   */
  const createConstraintNode = (constraintType: string): void => {
    try {
      store.createConstraintNode(resolveNodeSpawnPosition(), constraintType as ConstraintKind)
    } catch (error) {
      logger.error('创建约束节点失败:', error)
      toastError(t('messages.common.createNodeFailed'))
    }
  }

  /**
   * 创建 Transform 节点
   * @param transformType 转换类型
   */
  const createTransform = (transformType: TransformTypeV2): void => {
    try {
      store.createTransformNode(resolveNodeSpawnPosition(), transformType)
    } catch (error) {
      logger.error('创建Transform节点失败:', error)
      toastError(t('messages.common.createNodeFailed'))
    }
  }

  /**
   * 创建手动数据节点
   */
  const createManualData = (): void => {
    try {
      store.createManualDataNode(resolveNodeSpawnPosition())
    } catch (error) {
      logger.error('创建手动数据节点失败:', error)
      toastError(t('messages.common.createNodeFailed'))
    }
  }

  /**
   * 创建模板实例节点
   */
  const createTemplateInstance = (): void => {
    try {
      store.createTemplateInstanceNode(resolveNodeSpawnPosition())
    } catch (error) {
      logger.error('创建模板实例节点失败:', error)
      toastError(t('messages.common.createNodeFailed'))
    }
  }

  return {
    createProjectRoot,
    createTableSchema,
    createJsonSchema,
    createRegexPattern,
    createRegexExtract,
    createConstraintNode,
    createTransform,
    createManualData,
    createTemplateInstance,
  }
}
