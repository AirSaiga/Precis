/**
 * @file useSchemaData.ts
 * @description Schema数据管理组合式函数
 *
 * 该模块负责管理 Schema 节点的数据结构，包括列的增删改查等核心操作。
 * 底层逻辑已提取至 useSchemaDataBase，本文件仅做类型特化包装。
 */

import type { EmitFn } from 'vue'
import type { SchemaNodeData, SchemaColumn } from '../types'
import { useSchemaDataBase } from '../shared/useSchemaDataBase'

export function useSchemaData(
  props: { id: string; data: SchemaNodeData },
  emit: EmitFn<{ dataChanged: [SchemaNodeData] }>
) {
  return useSchemaDataBase<SchemaColumn, SchemaNodeData>(props, emit)
}
