/**
 * @file resourceDragStore.ts
 * @description 资源拖拽状态管理（资源树/数据源库 -> 画布）
 *
 * 说明：
 * - dragStore.ts 用于"字段拖拽/节点内部拖拽"的跨组件通信。
 * - 资源树拖拽 payload 与字段拖拽 payload 结构不同，
 *   为避免类型冲突与误用，单独拆分此 store。
 *
 * 数据流：
 * 资源树 dragstart → startDrag(payload) → DragGhost 显示
 * 画布 drop → endDrag() → graphStore 创建对应节点
 */

import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { EmbeddedConstraintResource, ColumnImplicitRegexInfo } from '@/types/resource'

/**
 * 资源拖拽类型枚举
 *
 * 标识从资源树拖出的资源类型，画布根据不同类型创建对应的节点。
 */
export type ResourceDragType =
  | 'schema'
  | 'jsonSchema'
  | 'pattern'
  | 'regex'
  | 'regex_node'
  | 'regexExtract'
  | 'constraint'
  | 'transform'
  | 'manualData'
  | 'embedded_constraint'
  | 'projectConfig'
  | 'projectRoot'
  | 'patternFolder'
  | 'constraintFolder'
  | 'external_data_source'
  | 'templateInstance'

/**
 * 资源拖拽载荷
 *
 * 包含从资源树拖出时携带的全部元信息，
 * 画布 drop 事件处理器根据这些信息创建对应的节点。
 */
export interface ResourceDragPayload {
  /** 资源类型 */
  type: ResourceDragType
  /** 来源标识（如 'resource-tree'） */
  source: string
  /** 附加元数据 */
  meta?: Record<string, unknown>
  /** 文件 ID（Electron 环境下为绝对路径） */
  fileId?: string
  /** 文件显示名称 */
  fileName?: string
  /** 资源名称 */
  name?: string
  /** 文件 MIME 类型 */
  fileType?: string
  /** 数据源 ID */
  sourceId?: string
  /** 显示标签 */
  label?: string
  /** 来源模式（如 'localfile'） */
  sourceMode?: string
  /** 本地文件路径 */
  localPath?: string
  /** 关联的正则 ID 列表 */
  associatedRegexIds?: string[]
  /** 关联的约束 ID 列表 */
  associatedConstraintIds?: string[]
  /** 内嵌约束资源列表 */
  embeddedConstraints?: EmbeddedConstraintResource[]
  /** 隐式正则字段信息 */
  implicitRegexFields?: ColumnImplicitRegexInfo[]
}

/**
 * 资源拖拽内部状态结构
 *
 * 描述资源树拖拽的当前状态，包括是否正在拖拽以及携带的载荷数据。
 */
interface ResourceDragState {
  /** 是否正在拖拽中 */
  isDragging: boolean
  /** 当前拖拽的载荷数据 */
  payload: ResourceDragPayload | null
}

/**
 * 资源拖拽状态管理 Store
 *
 * 管理从资源树/数据源库向画布拖拽资源时的状态。
 * 与 dragStore.ts 分工：dragStore 处理字段级拖拽，本 Store 处理资源级拖拽。
 */
export const useResourceDragStore = defineStore('resourceDrag', () => {
  // --- State ---

  /** 资源拖拽状态，初始为未拖拽 */
  const state = ref<ResourceDragState>({
    isDragging: false,
    payload: null,
  })

  // --- Getters ---

  /** 当前是否处于资源拖拽中，用于显示拖拽幽灵元素 */
  const isDragging = computed(() => state.value.isDragging)

  /** 当前拖拽的资源载荷，画布 drop 时根据此数据创建对应节点 */
  const payload = computed(() => state.value.payload)

  // --- Actions ---

  /**
   * 开始资源拖拽
   *
   * 在资源树的 dragstart 事件中调用，
   * 将拖拽载荷保存到 store，供画布 drop 事件读取。
   * 同时设置 isDragging 为 true，触发 DragGhost 组件显示。
   *
   * @param p - 拖拽载荷，包含资源类型和元信息
   */
  const startDrag = (p: ResourceDragPayload) => {
    state.value.isDragging = true
    state.value.payload = p
  }

  /**
   * 结束资源拖拽
   *
   * 在 dragend 或 drop 事件中调用，清空拖拽状态和载荷数据。
   * 同时设置 isDragging 为 false，隐藏 DragGhost 组件。
   */
  const endDrag = () => {
    state.value.isDragging = false
    state.value.payload = null
  }

  return {
    state,
    isDragging,
    payload,
    startDrag,
    endDrag,
  }
})
