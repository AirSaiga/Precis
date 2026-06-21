/**
 * @file expressionStore.ts
 * @description 表达式规则管理 Store
 *
 * 管理表达式解析规则（Pattern）的加载、保存和编辑状态。
 * 通过后端 Pattern API（/project/pattern）实现 CRUD。
 *
 * 核心功能：
 * - fetchExpressions: 从后端加载 Pattern 列表
 * - saveExpressions: 将本地变更（新增/修改/删除）同步到后端
 * - addRule: 在本地添加新规则（待 saveExpressions 落盘）
 * - patternNames: 计算属性，获取所有规则名称
 *
 * 数据结构：
 * - ExpressionRule: { name, regex, output }
 */

import { logger } from '@/core/utils/logger'
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { toastSuccess } from '@/core/toast'
import { useProjectStore } from './projectStore'
import {
  listV2Patterns,
  createV2Pattern,
  updateV2Pattern,
  deleteV2Pattern,
} from '@/api/projectV2Api/pattern'

export interface ExpressionRule {
  name: string
  regex: string
  output?: Record<string, unknown>
}

export const useExpressionStore = defineStore('expressions', () => {
  const { t } = useI18n()
  const projectStore = useProjectStore()
  const patterns = ref<ExpressionRule[]>([])
  const isLoading = ref(false)

  const patternNames = computed(() => patterns.value.map((p) => p.name))

  function configPath(): string | undefined {
    return projectStore.currentPaths?.configPath || undefined
  }

  async function fetchExpressions() {
    logger.debug('Fetching expressions from API...')
    isLoading.value = true
    try {
      const raw = await listV2Patterns(configPath())
      patterns.value = raw.map((r) => ({
        name: String(r.name ?? ''),
        regex: String(r.regex ?? ''),
        output: (r.output as Record<string, unknown> | undefined) ?? undefined,
      }))
      logger.debug('Expressions loaded:', patterns.value.length)
    } catch (e) {
      logger.error('Failed to fetch expressions:', e)
      patterns.value = []
    } finally {
      isLoading.value = false
    }
  }

  async function saveExpressions() {
    logger.debug('Saving expressions to API...')
    isLoading.value = true
    const cp = configPath()
    try {
      // 先读取后端现有列表，做 diff
      const remote = await listV2Patterns(cp)
      const remoteNames = new Set(remote.map((r) => String(r.name)))
      const localNames = new Set(patterns.value.map((p) => p.name))

      // 删除：后端有但本地无
      for (const r of remote) {
        const name = String(r.name)
        if (!localNames.has(name)) {
          await deleteV2Pattern(name, cp)
        }
      }

      // 新增/更新：本地每条
      for (const p of patterns.value) {
        const payload = { name: p.name, regex: p.regex, output: p.output, overwrite: true }
        if (remoteNames.has(p.name)) {
          await updateV2Pattern(p.name, payload, cp)
        } else {
          await createV2Pattern(payload, cp)
        }
      }

      toastSuccess(t('messages.success.expressionSaved'))
    } catch (e) {
      logger.error('Failed to save expressions:', e)
    } finally {
      isLoading.value = false
    }
  }

  function addRule() {
    const newRule: ExpressionRule = { name: 'new_rule', regex: '', output: {} }
    // [safe-push] patterns 是独立的响应式数组，非 Vue Flow 节点/边
    patterns.value.push(newRule)
    return newRule
  }

  return {
    patterns,
    isLoading,
    patternNames,
    fetchExpressions,
    saveExpressions,
    addRule,
  }
})
