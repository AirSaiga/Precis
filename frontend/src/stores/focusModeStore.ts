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
 * @fileoverview 专注模式视图状态管理：isFocusMode 布尔状态 + 布局快照容器（纯状态 store）。
 *
 * 职责：
 * - 持有专注模式布尔状态（isFocusMode）与进入前的布局快照（snapshot）
 * - 提供 setFocusMode / toggleFocus 状态操作
 *
 * 边界约定（纯状态 store）：
 * - 不 import useAppLayout、不做任何 AI 任务清理——布局快照的写入与恢复
 *   编排在 App.vue（layout 实例与 currentView 都在 App.vue 作用域），
 *   store 只提供状态容器
 * - 单一布局下专注模式仅是视图状态，NodeCanvas / AIChatPanel 不重挂载，
 *   无切换竞态需要治理
 */

import { ref } from 'vue'
import { defineStore } from 'pinia'

/** 侧边栏视图类型（与 AssetLibrary / AssetLibraryNav 的视图联合一致） */
export type SidebarView = 'toolbox' | 'resources' | 'ai-chat' | 'validation-history' | 'data'

/** 进入专注模式前的布局快照（退出时逐项恢复） */
export interface FocusModeSnapshot {
  /** ActivityBar（最左侧图标栏）是否收起 */
  activityBarCollapsed: boolean
  /** 左侧边栏是否收起 */
  sidebarCollapsed: boolean
  /** 右侧面板是否收起 */
  rightCollapsed: boolean
  /** 左侧边栏宽度（px） */
  sidebarWidth: number
  /** 侧边栏当前视图 */
  currentView: SidebarView
}

/**
 * 专注模式 Store 工厂函数
 *
 * 使用 Pinia Setup Store 模式，只持有状态与状态操作：
 * - isFocusMode：专注模式开关
 * - snapshot：进入前的布局快照，由 App.vue 在进入时写入、退出恢复后清空
 */
export const useFocusModeStore = defineStore('focusMode', () => {
  // --- 核心状态 ---
  /** 是否处于专注模式 */
  const isFocusMode = ref(false)
  /** 进入专注模式前的布局快照（null 表示无快照，即未处于专注模式或已恢复） */
  const snapshot = ref<FocusModeSnapshot | null>(null)

  // --- Actions ---

  /**
   * 切换专注模式状态（同值早退）
   *
   * @param next - 目标状态
   */
  function setFocusMode(next: boolean) {
    if (isFocusMode.value === next) return
    isFocusMode.value = next
  }

  /** 在专注 / 普通布局之间切换 */
  function toggleFocus() {
    setFocusMode(!isFocusMode.value)
  }

  // --- 导出 ---
  return {
    isFocusMode,
    snapshot,
    setFocusMode,
    toggleFocus,
  }
})
