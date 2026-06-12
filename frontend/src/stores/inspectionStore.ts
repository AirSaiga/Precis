/**
 * @file inspectionStore.ts
 * @description 配置自检结果与 UI 状态管理
 *
 * 核心职责:
 * - 保存后端返回的最新 InspectionResultV2
 * - 管理抽屉（drawer）打开/关闭
 * - 管理"忽略"列表，持久化到 localStorage（按错误 id 粒度）
 * - 提供过滤后的未解决问题列表供 UI 使用
 *
 * 设计说明:
 * - 模块级共享状态（仿照 useConfigInspection 旧实现），任意位置可调用
 * - "忽略" 状态跨会话持久化：用户关闭/重开项目后，忽略仍然有效
 * - 同一个错误 id 第二次出现时（如重新加载项目），仍处于忽略状态
 */

import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { InspectionIssue, InspectionResultV2 } from '@/types/projectV2'

const STORAGE_KEY = 'precis.inspection.ignoredIds.v1'

/**
 * 从 localStorage 读取已忽略的 issue id 集合
 *
 * 容错策略: 数据格式异常 / 存储不可用时返回空集合，不影响主流程
 */
function loadIgnoredFromStorage(): Set<string> {
  if (typeof localStorage === 'undefined') return new Set()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw)
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

/**
 * 把忽略集合写回 localStorage
 *
 * 容错策略: 写入失败仅记录 console，不抛错
 */
function saveIgnoredToStorage(ids: Set<string>): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]))
  } catch (e) {
    console.warn('[InspectionStore] 持久化忽略列表失败:', e)
  }
}

export const useInspectionStore = defineStore('inspection', () => {
  // === 状态 ===
  /** 最新一次自检结果，null 表示尚未自检 */
  const currentResult = ref<InspectionResultV2 | null>(null)
  /** 抽屉是否可见 */
  const drawerVisible = ref(false)
  /** 抽屉内分组模式: file（按文件） / severity（按严重度） */
  const groupBy = ref<'file' | 'severity'>('file')
  /** 已忽略的 issue id 集合（从 localStorage 恢复） */
  const ignoredIds = ref<Set<string>>(loadIgnoredFromStorage())
  /** 正在进行 auto_fix 的 issue id（用于按钮 loading 态） */
  const fixingIds = ref<Set<string>>(new Set())

  // === 计算属性 ===
  /** 当前结果中所有问题（不考虑忽略） */
  const allIssues = computed<InspectionIssue[]>(() => currentResult.value?.errors ?? [])

  /** 过滤掉已忽略的问题 */
  const unresolvedIssues = computed<InspectionIssue[]>(() =>
    allIssues.value.filter((i) => !ignoredIds.value.has(i.id))
  )

  /** 未解决问题的数量 */
  const unresolvedCount = computed(() => unresolvedIssues.value.length)

  /** 未解决问题中最高的严重度（用于徽章颜色） */
  const maxSeverity = computed<'blocker' | 'warning' | 'info' | null>(() => {
    const issues = unresolvedIssues.value
    if (issues.some((i) => i.severity === 'blocker')) return 'blocker'
    if (issues.some((i) => i.severity === 'warning')) return 'warning'
    if (issues.length > 0) return 'info'
    return null
  })

  /** 是否有未解决的 blocker（用于自动展开抽屉） */
  const hasBlocker = computed(() => unresolvedIssues.value.some((i) => i.severity === 'blocker'))

  // === 动作 ===
  /**
   * 设置最新自检结果（并可选择是否自动打开抽屉）
   *
   * 调用时机:
   * - 项目加载完成时（useAppBootstrap / loadProjectFromV2）
   * - 手动 "重新检查" 按钮
   *
   * @param result 后端返回的 InspectionResultV2
   * @param options.autoOpen 是否自动打开抽屉
   *   - true: 无条件打开
   *   - 'if-blocker': 仅在存在 blocker 时打开
   *   - false / undefined: 不打开（仅写入结果）
   */
  function setResult(
    result: InspectionResultV2,
    options: { autoOpen?: boolean | 'if-blocker' } = {}
  ): void {
    currentResult.value = result
    const shouldOpen =
      options.autoOpen === true || (options.autoOpen === 'if-blocker' && hasBlocker.value)
    if (shouldOpen) drawerVisible.value = true
  }

  /** 打开抽屉 */
  function openDrawer(): void {
    drawerVisible.value = true
  }

  /** 关闭抽屉 */
  function closeDrawer(): void {
    drawerVisible.value = false
  }

  /** 切换分组模式 */
  function setGroupBy(mode: 'file' | 'severity'): void {
    groupBy.value = mode
  }

  /**
   * 忽略指定 issue
   *
   * 持久化到 localStorage。下次相同 id 的 issue 出现时仍保持忽略。
   */
  function dismiss(issueId: string): void {
    if (ignoredIds.value.has(issueId)) return
    const next = new Set(ignoredIds.value)
    next.add(issueId)
    ignoredIds.value = next
    saveIgnoredToStorage(next)
  }

  /**
   * 恢复（取消忽略）指定 issue
   */
  function restore(issueId: string): void {
    if (!ignoredIds.value.has(issueId)) return
    const next = new Set(ignoredIds.value)
    next.delete(issueId)
    ignoredIds.value = next
    saveIgnoredToStorage(next)
  }

  /** 清空所有忽略记录 */
  function clearAllIgnored(): void {
    ignoredIds.value = new Set()
    saveIgnoredToStorage(ignoredIds.value)
  }

  /**
   * 把 issue 标记为正在修复中（用于按钮 loading 态）
   */
  function markFixing(issueId: string, fixing: boolean): void {
    const next = new Set(fixingIds.value)
    if (fixing) next.add(issueId)
    else next.delete(issueId)
    fixingIds.value = next
  }

  /** 判断某 issue 是否正在修复中 */
  function isFixing(issueId: string): boolean {
    return fixingIds.value.has(issueId)
  }

  return {
    // 状态
    currentResult,
    drawerVisible,
    groupBy,
    ignoredIds,
    fixingIds,
    // 计算
    allIssues,
    unresolvedIssues,
    unresolvedCount,
    maxSeverity,
    hasBlocker,
    // 动作
    setResult,
    openDrawer,
    closeDrawer,
    setGroupBy,
    dismiss,
    restore,
    clearAllIgnored,
    markFixing,
    isFixing,
  }
})
