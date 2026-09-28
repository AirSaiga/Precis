/*
 * SPDX-License-Identifier: Apache-2.0
 *
 * Copyright 2026 Precis Team
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/**
 * @fileoverview constraintOverviewStore.ts — Schema 约束概览弹层的全局开合状态
 *
 * 弹层由各 Schema/jsonSchema 节点组件实例化（Teleport 到 body），
 * 但"哪个 Schema 的概览打开"必须是全局唯一的（互斥）——本 store 持有
 * activeSchemaId 单一事实源：
 * - toggle/open/close：头部按钮开合（开一个自动关其他）
 * - 画布节点消失（删除 / 清空画布 / 多标签画布切换）时自动关闭，
 *   防止陈旧 id 残留（同 id 重新导入时会"凭空"弹出）
 */
import { ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { useGraphStore } from './graphStore'

export const useConstraintOverviewStore = defineStore('constraintOverview', () => {
  /** 当前打开约束概览弹层的 Schema 节点 id；null = 全部关闭 */
  const activeSchemaId = ref<string | null>(null)

  /** 打开指定 Schema 的概览（互斥：覆盖其他） */
  function open(schemaNodeId: string): void {
    activeSchemaId.value = schemaNodeId
  }

  /** 关闭当前概览 */
  function close(): void {
    activeSchemaId.value = null
  }

  /** 开关切换：同 id 再点关闭，异 id 切换目标 */
  function toggle(schemaNodeId: string): void {
    activeSchemaId.value = activeSchemaId.value === schemaNodeId ? null : schemaNodeId
  }

  // 活跃 Schema 节点从画布消失 → 自动关闭。
  // 复用 graphStore（canvasStore 同款跨 store 引用）；watcher 随 store 生命周期，
  // 无需手动清理。仅跟踪"存在性"，不深入 data，重开销可忽略。
  const graphStore = useGraphStore()
  watch(
    () =>
      activeSchemaId.value ? graphStore.nodes.some((n) => n.id === activeSchemaId.value) : true,
    (exists) => {
      if (!exists) activeSchemaId.value = null
    }
  )

  return {
    activeSchemaId,
    open,
    close,
    toggle,
  }
})
