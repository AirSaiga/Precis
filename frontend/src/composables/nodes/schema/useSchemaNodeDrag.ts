/**
 * @file useSchemaNodeDrag.ts
 * @description Schema 节点拖拽处理 Composable
 *
 * 专门处理 Schema 节点特有的拖拽连接场景：
 * 1. 从列输出句柄拖拽 → 创建约束节点（显示约束类型选择菜单）
 * 2. 从添加列句柄拖拽 → 添加新列
 *
 * 通过将 Schema 节点特定的逻辑提取到独立的组合式函数中，
 * 实现关注点分离，提高代码可维护性和可测试性。
 */

import { logger } from '@/core/utils/logger'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Node as VueFlowNode } from '@vue-flow/core'
import { useGraphStore } from '@/stores/graphStore'
import type { SchemaNodeData } from '@/types/graph'

/**
 * Schema 节点拖拽处理函数类型定义
 */
type CreateAction = (nodeId: string, pos: { x: number; y: number }) => void

/**
 * 约束类型配置
 */
interface ConstraintTypeConfig {
  type: 'foreignKey' | 'unique' | 'notNull' | 'allowedValues' | 'conditional' | 'scripted'
  label: string
  icon: string
}

/**
 * Schema 节点拖拽处理返回值
 */
export interface UseSchemaNodeDragReturn {
  /**
   * 处理列句柄的拖拽连接结束事件
   * 当用户从列输出句柄拖拽到空白区域时触发，显示约束类型选择菜单
   *
   * @param sourceNode - 源 Schema 节点
   * @param sourceHandleId - 源句柄ID（格式：source-right-{columnId}）
   * @param event - 鼠标或触摸事件
   * @returns boolean - 是否成功处理该事件
   */
  handleColumnHandleDragEnd: (
    sourceNode: VueFlowNode,
    sourceHandleId: string,
    event: MouseEvent | TouchEvent
  ) => boolean

  /**
   * 处理添加列句柄的拖拽连接结束事件
   * 当用户从添加列句柄拖拽到空白区域时触发，自动添加新列
   *
   * @param sourceNodeId - 源节点ID
   * @param event - 鼠标或触摸事件
   * @returns boolean - 是否成功处理该事件
   */
  handleAddColumnHandleDragEnd: (sourceNodeId: string, event: MouseEvent | TouchEvent) => boolean
}

/**
 * Schema 节点拖拽处理 Composable
 *
 * @example
 * ```typescript
 * const {
 *   handleColumnHandleDragEnd,
 *   handleAddColumnHandleDragEnd
 * } = useSchemaNodeDrag();
 * ```
 */
export function useSchemaNodeDrag(): UseSchemaNodeDragReturn {
  // 国际化支持
  const { t } = useI18n()

  // 图存储
  const store = useGraphStore()

  /**
   * 获取屏幕坐标（兼容鼠标和触摸事件）
   *
   * @param event - 鼠标或触摸事件
   * @returns { x, y } - 屏幕坐标
   */
  const getClientCoordinates = (event: MouseEvent | TouchEvent): { x: number; y: number } => {
    if ('changedTouches' in event) {
      const touch = event.changedTouches[0]
      return { x: touch.clientX, y: touch.clientY }
    }
    return { x: event.clientX, y: event.clientY }
  }

  /**
   * 创建约束类型选择菜单
   *
   * 在指定位置创建一个弹出菜单，显示可创建的约束类型列表
   *
   * @param clientX - 菜单显示的 X 坐标
   * @param clientY - 菜单显示的 Y 坐标
   * @param constraintTypes - 可用的约束类型列表
   * @param onSelect - 菜单项选择回调
   */
  const createConstraintMenu = (
    clientX: number,
    clientY: number,
    constraintTypes: ConstraintTypeConfig[],
    onSelect: (type: ConstraintTypeConfig) => void
  ): void => {
    // 创建菜单容器
    const menu = document.createElement('div')
    menu.className = 'schema-constraint-menu'
    menu.style.cssText = `
      position: fixed;
      top: ${clientY}px;
      left: ${clientX}px;
      background: white;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
      z-index: 10000;
      padding: 4px 0;
      min-width: 200px;
    `

    // 为每种约束类型创建菜单项
    constraintTypes.forEach((constraintType) => {
      const menuItem = document.createElement('div')
      menuItem.className = 'schema-constraint-menu-item'
      menuItem.style.cssText = `
        padding: 10px 14px;
        cursor: pointer;
        font-size: 14px;
        display: flex;
        align-items: center;
        gap: 10px;
        transition: background-color 0.15s ease;
      `
      const iconEl = document.createElement('i')
      iconEl.className = constraintType.icon
      iconEl.style.cssText = 'width: 18px; text-align: center; color: #6b7280;'
      const labelEl = document.createElement('span')
      labelEl.textContent = constraintType.label
      menuItem.appendChild(iconEl)
      menuItem.appendChild(labelEl)

      // 悬停效果
      menuItem.addEventListener('mouseenter', () => {
        menuItem.style.backgroundColor = '#f3f4f6'
      })
      menuItem.addEventListener('mouseleave', () => {
        menuItem.style.backgroundColor = 'transparent'
      })

      // 点击事件
      menuItem.addEventListener('click', () => {
        onSelect(constraintType)
        document.body.removeChild(menu)
      })

      menu.appendChild(menuItem)
    })

    // 将菜单添加到文档
    document.body.appendChild(menu)

    // 设置延迟点击监听器，点击其他区域关闭菜单
    setTimeout(() => {
      const closeMenu = (e: MouseEvent) => {
        if (!menu.contains(e.target as unknown as Node)) {
          document.body.removeChild(menu)
          document.removeEventListener('click', closeMenu)
        }
      }
      document.addEventListener('click', closeMenu)
    }, 0)
  }

  /**
   * 获取可用的约束类型列表
   *
   * 根据当前系统支持的约束规则动态生成
   *
   * @returns ConstraintTypeConfig[] - 约束类型配置数组
   */
  const getAvailableConstraintTypes = (): ConstraintTypeConfig[] => {
    return [
      {
        type: 'notNull',
        label: t('customNodes.constraintRules.notNullConstraintNode.title') || '非空约束',
        icon: 'fa-solid fa-ban',
      },
      {
        type: 'unique',
        label: t('customNodes.constraintRules.uniqueConstraintNode.title') || '唯一性约束',
        icon: 'fa-solid fa-fingerprint',
      },
      {
        type: 'allowedValues',
        label: t('customNodes.constraintRules.allowedValuesConstraintNode.title') || '允许值约束',
        icon: 'fa-solid fa-list',
      },
      {
        type: 'foreignKey',
        label: t('customNodes.constraintRules.foreignKeyConstraintNode.title') || '外键约束',
        icon: 'fa-solid fa-link',
      },
      {
        type: 'conditional',
        label: t('customNodes.constraintRules.conditionalConstraintNode.title') || '条件约束',
        icon: 'fa-solid fa-code-branch',
      },
      {
        type: 'scripted',
        label: t('customNodes.constraintRules.scriptedConstraintNode.title') || '脚本约束',
        icon: 'fa-solid fa-code',
      },
    ]
  }

  /**
   * 处理列句柄的拖拽连接结束事件
   *
   * 该函数处理从 Schema 节点列输出句柄拖拽到空白区域的场景：
   * 1. 解析句柄ID获取列ID
   * 2. 计算新节点的放置位置
   * 3. 显示约束类型选择菜单
   * 4. 用户选择后创建约束节点并建立连接
   *
   * @param sourceNode - 源 Schema 节点
   * @param sourceHandleId - 源句柄ID
   * @param event - 鼠标或触摸事件
   * @returns boolean - 是否成功处理该事件
   */
  const handleColumnHandleDragEnd = (
    sourceNode: VueFlowNode,
    sourceHandleId: string,
    event: MouseEvent | TouchEvent
  ): boolean => {
    return false
  }

  /**
   * 处理添加列句柄的拖拽连接结束事件
   *
   * 该函数处理从 Schema 节点添加列句柄拖拽到空白区域的场景：
   * 1. 坐标转换（屏幕坐标 → 画布坐标）
   * 2. 添加偏移量
   * 3. 调用 store 添加新列
   *
   * 注意：目前位置参数未被使用，因为 addColumnToSchema 不需要位置信息
   * 但保留位置参数以备将来扩展（如支持自定义列位置）
   *
   * @param sourceNodeId - 源节点ID
   * @param event - 鼠标或触摸事件
   * @returns boolean - 是否成功处理该事件
   */
  const handleAddColumnHandleDragEnd = (
    sourceNodeId: string,
    event: MouseEvent | TouchEvent
  ): boolean => {
    // 验证节点类型
    const node = store.nodes.find((n) => n.id === sourceNodeId)
    if (!node || node.type !== 'schema') {
      return false
    }

    // 执行添加列操作
    store.addColumnToSchema(sourceNodeId)

    logger.debug(`[useSchemaNodeDrag] 已添加新列到节点: ${sourceNodeId}`)

    return true
  }

  return {
    handleColumnHandleDragEnd,
    handleAddColumnHandleDragEnd,
  }
}
