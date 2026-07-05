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

export function useSchemaDataBase<
  TColumn extends BaseSchemaColumn,
  TNodeData extends BaseSchemaNodeData<TColumn>,
>(
  props: { id: string; data: TNodeData },
  emit: EmitFn<{ dataChanged: [TNodeData] }>,
  options?: SchemaDataBaseOptions<TColumn>
) {
  const store = useGraphStore()

  const schemaData = reactive<TNodeData>(structuredClone(deepToRaw(props.data)))

  const notifyDataChanged = () => {
    nextTick(() => {
      emit('dataChanged', toRaw(schemaData) as TNodeData)
      store.updateNodeData(
        props.id,
        structuredClone(deepToRaw(schemaData)) as Record<string, unknown>
      )
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
