/**
 * @file useSchemaDataBase.ts
 * @description Schema / JsonSchema 节点共享的数据管理基础组合式函数
 *
 * 提取 useSchemaData 与 useJsonSchemaData 中重复的 CRUD 逻辑，
 * 消除 ~80 行镜像代码。
 *
 * 设计要点：
 * - 泛型参数 TColumn / TNodeData 同时适配 Schema 与 JsonSchema
 * - findColumn 可注入，默认使用平面查找；JsonSchema 传入递归实现
 * - updateColumn 统一使用 Object.assign，兼容 reactive 嵌套对象
 * - 回写 store 时按 buildWritebackPatch 合并 props.data 中的外部更新，
 *   避免过期快照回滚挂载后由其他路径写入的字段（连接信息等）
 */

import { reactive, nextTick, toRaw } from 'vue'
import type { EmitFn } from 'vue'
import { useGraphStore } from '@/stores/graphStore'
import { deepToRaw } from '@/utils/typeHelpers'
import type { BaseSchemaColumn, BaseSchemaNodeData } from '../types'

export interface SchemaDataBaseOptions<TColumn extends BaseSchemaColumn> {
  /**
   * 自定义列查找器。
   * 默认使用平面查找（columns.findIndex）。
   * JsonSchema 可传入递归查找器以支持嵌套 children。
   */
  findColumn?: (
    columns: TColumn[],
    columnId: string
  ) => { column: TColumn; parentArray: TColumn[]; index: number } | null
}

/**
 * 深比较两个"JSON 安全"的值是否相等（节点数据是纯配置数据，不含 Date/Map/Set）。
 * 用于判断快照中的键在克隆后是否被本组件修改过。
 * 非 plain object/array 的值退化为引用/原始值比较。
 */
export function isSnapshotValueEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const aObj = a as Record<string, unknown>
  const bObj = b as Record<string, unknown>
  const aKeys = Object.keys(aObj)
  const bKeys = Object.keys(bObj)
  if (aKeys.length !== bKeys.length) return false
  return aKeys.every((k) => k in bObj && isSnapshotValueEqual(aObj[k], bObj[k]))
}

/**
 * 构建"回写 store"的合并补丁（纯函数，供单测直接覆盖）。
 *
 * 背景：schemaData 是 setup 时对 props.data 的一次性克隆快照。节点挂载后，
 * 其他路径会绕过本组件直接 store.updateNodeData 写入新值（如连接数据源写入
 * tableName/sourceFile/sourceNodeId/sheetName，useJsonSchemaInteractions 写入
 * 列级约束标记/jsonPath）。updateNodeData 是浅合并——快照中**已存在**的键会以
 * 快照里的旧值覆盖 store 最新值。若把整份过期快照回写，外部写入会被回滚。
 *
 * 合并策略（回写 = 本地快照 ∪ props 最新值中未被本组件修改的键）：
 * - 以本地快照为基底，保持既有"全量回写"对消费方的兼容性；
 * - 遍历 props.data（store 最新数据）的每个键：
 *   1. 快照未持有的键（挂载后外部新增，如 sourceNodeId）→ 透传 props 最新值；
 *   2. 本组件未修改的键（快照值与克隆时的 base 相等）→ 透传 props 最新值，
 *      避免回滚外部写入；
 *   3. 本组件修改过的键（快照值 ≠ base，如 columns/saveState）→ 保留本地值。
 *      columns 深层结构由本组件权威管理，不能被 props 旧值覆盖。
 *   （若同一键被本组件与外部在同一窗口内都修改，以本组件为准——last-write-wins
 *   中本组件的这次回写就是最后一次写，与既有行为一致。）
 */
export function buildWritebackPatch(
  baseSnapshot: Record<string, unknown>,
  localSnapshot: Record<string, unknown>,
  latestExternal: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...localSnapshot }
  for (const key of Object.keys(latestExternal)) {
    // 情形 1：快照未持有的键 → 外部新增字段，透传最新值
    if (!Object.prototype.hasOwnProperty.call(baseSnapshot, key)) {
      merged[key] = latestExternal[key]
      continue
    }
    // 情形 2：本组件未修改（与 base 相等）→ 透传 store 最新值
    if (isSnapshotValueEqual(localSnapshot[key], baseSnapshot[key])) {
      merged[key] = latestExternal[key]
    }
    // 情形 3：本组件修改过 → 保留本地值（已在 merged 中，不覆盖）
  }
  return merged
}

export function useSchemaDataBase<
  TColumn extends BaseSchemaColumn,
  TNodeData extends BaseSchemaNodeData<TColumn>,
>(
  props: { id: string; data: TNodeData },
  emit: EmitFn<{ dataChanged: [TNodeData] }>,
  options?: SchemaDataBaseOptions<TColumn>
) {
  const store = useGraphStore()

  // 克隆时的 base 快照：回写时用于区分"本组件修改过的键"与"外部更新的键"
  const baseSnapshot = structuredClone(deepToRaw(props.data)) as Record<string, unknown>

  const schemaData = reactive<TNodeData>(structuredClone(baseSnapshot) as TNodeData)

  const notifyDataChanged = () => {
    nextTick(() => {
      emit('dataChanged', toRaw(schemaData) as TNodeData)
      // 回写前先合并 props.data 中的外部更新（连接信息等），避免过期快照回滚
      // 挂载后由其他路径写入的字段（详见 buildWritebackPatch 注释）
      const patch = buildWritebackPatch(
        baseSnapshot,
        deepToRaw(schemaData) as Record<string, unknown>,
        deepToRaw(props.data) as Record<string, unknown>
      )
      store.updateNodeData(props.id, structuredClone(patch))
    })
  }

  const findColumnFlat = (
    columns: TColumn[],
    columnId: string
  ): { column: TColumn; parentArray: TColumn[]; index: number } | null => {
    const index = columns.findIndex((col) => col.id === columnId)
    if (index !== -1) {
      const column = columns[index]
      if (column) {
        return { column, parentArray: columns, index }
      }
    }
    return null
  }

  const findColumn = options?.findColumn || findColumnFlat

  const addColumn = (column: TColumn) => {
    ;(schemaData.columns as TColumn[]).push(column)
    notifyDataChanged()
  }

  const updateColumn = (columnId: string, updates: Partial<TColumn>) => {
    const result = findColumn(schemaData.columns as TColumn[], columnId)
    if (result) {
      Object.assign(result.column, updates)
      notifyDataChanged()
    }
  }

  const deleteColumn = (columnId: string) => {
    const result = findColumn(schemaData.columns as TColumn[], columnId)
    if (result) {
      result.parentArray.splice(result.index, 1)
      notifyDataChanged()
    }
  }

  const reorderColumns = (fromIndex: number, toIndex: number) => {
    const [removed] = (schemaData.columns as TColumn[]).splice(fromIndex, 1)
    ;(schemaData.columns as TColumn[]).splice(toIndex, 0, removed as TColumn)
    notifyDataChanged()
  }

  const updateSchemaData = (updates: Partial<TNodeData>) => {
    Object.assign(schemaData, updates)
    notifyDataChanged()
  }

  return {
    store,
    schemaData,
    addColumn,
    updateColumn,
    deleteColumn,
    reorderColumns,
    updateSchemaData,
    notifyDataChanged,
  }
}
