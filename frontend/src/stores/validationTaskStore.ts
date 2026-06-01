/**
 * @file validationTaskStore.ts
 * @description 数据校验任务状态管理 Store
 *
 * 管理数据校验任务面板的显隐状态和校验目标配置。
 * 支持全项目校验和单表校验两种模式。
 *
 * 核心功能：
 * - open: 打开校验面板并设置目标
 * - openFullProject: 快捷打开全项目校验
 * - openSingleTable: 快捷打开指定单表校验
 * - close: 关闭校验面板
 *
 * 数据流：
 * 用户触发校验 → 设置 target（ValidationTaskTarget）→ 显示面板 → 提交后端校验 API
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ValidationTaskTarget } from '@/api/projectValidationApi'

const defaultTarget: ValidationTaskTarget = {
  type: 'full_project',
  display_name: '全项目',
}

export const useValidationTaskStore = defineStore('validationTask', () => {
  /** 校验任务面板是否可见 */
  const visible = ref(false)

  /** 当前校验目标配置 */
  const target = ref<ValidationTaskTarget>({ ...defaultTarget })

  /** 最近一次校验完成的时间戳，用于触发历史记录刷新 */
  const lastRunTimestamp = ref<number>(0)

  /**
   * 打开校验任务面板
   *
   * 使用 defaultTarget 作为基础，传入的 nextTarget 会覆盖对应字段。
   *
   * @param nextTarget - 校验目标配置，默认使用全项目校验
   */
  function open(nextTarget: ValidationTaskTarget = defaultTarget): void {
    target.value = {
      ...defaultTarget,
      ...nextTarget,
    }
    visible.value = true
  }

  /**
   * 快捷打开全项目校验
   *
   * 调用 open() 并传入全项目校验的默认目标。
   */
  function openFullProject(): void {
    open({
      type: 'full_project',
      display_name: '全项目',
    })
  }

  /**
   * 快捷打开指定单表校验
   *
   * @param tableId - 目标表 ID
   * @param displayName - 显示名称，默认使用 tableId
   */
  function openSingleTable(tableId: string, displayName?: string): void {
    open({
      type: 'single_table',
      table_id: tableId,
      display_name: displayName || tableId,
    })
  }

  /**
   * 关闭校验任务面板
   */
  function close(): void {
    visible.value = false
  }

  return {
    visible,
    target,
    lastRunTimestamp,
    open,
    openFullProject,
    openSingleTable,
    close,
  }
})

export default useValidationTaskStore
