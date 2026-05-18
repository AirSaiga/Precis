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
  | 'regex_node'
  | 'constraint'
  | 'transform'
  | 'manualData'
  | 'embedded_constraint'
  | 'projectConfig'
  | 'projectRoot'
  | 'patternFolder'
  | 'constraintFolder'
  | 'external_data_source'

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

/** 拖拽内部状态结构 */
interface ResourceDragState {
  /** 是否正在拖拽中 */
  isDragging: boolean
  /** 当前拖拽的载荷数据 */
  payload: ResourceDragPayload | null
}

export const useResourceDragStore = defineStore('resourceDrag', () => {
  const state = ref<ResourceDragState>({
    isDragging: false,
    payload: null,
  })

  /** 当前是否处于拖拽状态 */
  const isDragging = computed(() => state.value.isDragging)

  /** 当前拖拽的载荷数据 */
  const payload = computed(() => state.value.payload)

  /**
   * 开始资源拖拽
   *
   * 在资源树的 dragstart 事件中调用，
   * 将拖拽载荷保存到 store，供画布 drop 事件读取。
   *
   * @param p - 拖拽载荷
   */
  const startDrag = (p: ResourceDragPayload) => {
    state.value.isDragging = true
    state.value.payload = p
  }

  /**
   * 结束资源拖拽
   *
   * 在 dragend 或 drop 事件中调用，清空拖拽状态和载荷数据。
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
