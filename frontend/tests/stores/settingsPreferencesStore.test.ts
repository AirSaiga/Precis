/**
 * @fileoverview settingsPreferencesStore 单元测试
 *
 * 覆盖用户偏好 store 的核心行为（GUI 走查对应单测锁定）：
 * - generalSettings 默认值 + Partial 合并更新 + localStorage 深度 watch 自动持久化
 * - 启动恢复采用"默认值兜底 + 存储值覆盖"合并（向前兼容，缺字段不丢默认值）
 * - scriptSettings 启用/禁用/管理员限制/警告时间戳 + 持久化
 * - devSettings 团队功能开关（开发环境遵循配置）
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'
import { useSettingsPreferencesStore } from '@/stores/settingsPreferencesStore'
import { defaultGeneralSettings, defaultScriptSettings } from '@/types/settings'

describe('settingsPreferencesStore', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  describe('generalSettings（通用设置）', () => {
    it('未存储时使用默认值（启动加载最近项目 / zh-CN / system 主题）', () => {
      const store = useSettingsPreferencesStore()
      expect(store.generalSettings).toEqual(defaultGeneralSettings)
      expect(store.generalSettings.loadRecentProjectOnStartup).toBe(true)
      expect(store.generalSettings.language).toBe('zh-CN')
      expect(store.generalSettings.theme).toBe('system')
    })

    it('updateGeneralSettings 仅合并传入字段（Partial 更新）', () => {
      const store = useSettingsPreferencesStore()
      store.updateGeneralSettings({ theme: 'dark' })
      expect(store.generalSettings.theme).toBe('dark')
      expect(store.generalSettings.language).toBe('zh-CN')
      expect(store.generalSettings.loadRecentProjectOnStartup).toBe(true)
    })

    it('修改后自动持久化到 localStorage（深度 watch）', async () => {
      const store = useSettingsPreferencesStore()
      store.updateGeneralSettings({ theme: 'dark', language: 'en-US' })
      await nextTick()
      const stored = JSON.parse(localStorage.getItem('generalSettings') || '{}')
      expect(stored.theme).toBe('dark')
      expect(stored.language).toBe('en-US')
    })

    it('启动恢复合并策略：存储缺字段时默认值兜底（主题持久化回归锁）', () => {
      // 模拟旧版本存储：只有 theme，无 language / loadRecentProjectOnStartup
      localStorage.setItem('generalSettings', JSON.stringify({ theme: 'dark' }))
      const store = useSettingsPreferencesStore()
      expect(store.generalSettings.theme).toBe('dark')
      expect(store.generalSettings.language).toBe('zh-CN')
      expect(store.generalSettings.loadRecentProjectOnStartup).toBe(true)
    })

    it('存储损坏（非法 JSON）时回退默认值不抛异常', () => {
      localStorage.setItem('generalSettings', '{invalid json')
      const store = useSettingsPreferencesStore()
      expect(store.generalSettings).toEqual(defaultGeneralSettings)
    })
  })

  describe('scriptSettings（脚本安全设置）', () => {
    it('默认禁用脚本且不要求管理员', () => {
      const store = useSettingsPreferencesStore()
      expect(store.scriptSettings).toEqual(defaultScriptSettings)
      expect(store.isScriptEnabled).toBe(false)
      expect(store.isScriptAdminOnly).toBe(false)
    })

    it('enableScript / disableScript 切换启用状态', () => {
      const store = useSettingsPreferencesStore()
      store.enableScript()
      expect(store.isScriptEnabled).toBe(true)
      store.disableScript()
      expect(store.isScriptEnabled).toBe(false)
    })

    it('setScriptRequireAdmin 更新管理员限制', () => {
      const store = useSettingsPreferencesStore()
      store.setScriptRequireAdmin(true)
      expect(store.isScriptAdminOnly).toBe(true)
    })

    it('markWarningShown 记录警告时间戳', () => {
      const store = useSettingsPreferencesStore()
      vi.useFakeTimers()
      store.markWarningShown()
      expect(store.scriptSettings.lastWarningTimestamp).toBe(Date.now())
      vi.useRealTimers()
    })

    it('脚本设置变更自动持久化', async () => {
      const store = useSettingsPreferencesStore()
      store.enableScript()
      await nextTick()
      const stored = JSON.parse(localStorage.getItem('scriptSettings') || '{}')
      expect(stored.enabled).toBe(true)
    })

    it('启动恢复合并策略：部分存储自动补默认字段', () => {
      localStorage.setItem('scriptSettings', JSON.stringify({ enabled: true }))
      const store = useSettingsPreferencesStore()
      expect(store.isScriptEnabled).toBe(true)
      expect(store.scriptSettings.requireAdmin).toBe(false)
      expect(store.scriptSettings.unsafeEvalWarning).toBe(true)
    })
  })

  describe('devSettings（开发设置）', () => {
    it('toggleTeamFeatures 切换并立即持久化', () => {
      const store = useSettingsPreferencesStore()
      const initial = store.devSettings.teamFeaturesEnabled
      store.toggleTeamFeatures()
      expect(store.devSettings.teamFeaturesEnabled).toBe(!initial)
      const stored = JSON.parse(localStorage.getItem('devSettings') || '{}')
      expect(stored.teamFeaturesEnabled).toBe(!initial)
    })
  })
})
