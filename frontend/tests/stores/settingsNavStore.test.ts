/**
 * @fileoverview settingsNavStore 单元测试
 *
 * 覆盖设置中心导航行为：
 * - 默认关闭、默认选中 general
 * - open/close/toggle 与 activeTab 映射（NavItem ↔ Tab 兼容层）
 * - close 清空搜索词防残留；isOpen 别名语义
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSettingsNavStore } from '@/stores/settingsNavStore'

describe('settingsNavStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('初始状态：面板关闭、activeNavItem 为 general、无搜索词', () => {
    const store = useSettingsNavStore()
    expect(store.visible).toBe(false)
    expect(store.isOpen).toBe(false)
    expect(store.activeNavItem).toBe('general')
    expect(store.searchQuery).toBe('')
  })

  it('open(tab) 打开面板并映射到对应导航项', () => {
    const store = useSettingsNavStore()
    store.open('shortcuts')
    expect(store.visible).toBe(true)
    expect(store.activeNavItem).toBe('shortcuts')
  })

  it('open 对 script tab 映射为 script-security 导航项，activeTab 反向还原', () => {
    const store = useSettingsNavStore()
    store.open('script')
    expect(store.activeNavItem).toBe('script-security')
    expect(store.activeTab).toBe('script')
  })

  it('open 对 project-info tab 映射为 project-overview 导航项', () => {
    const store = useSettingsNavStore()
    store.open('project-info')
    expect(store.activeNavItem).toBe('project-overview')
    expect(store.activeTab).toBe('project-info')
  })

  it('open 无参默认打开 general', () => {
    const store = useSettingsNavStore()
    store.open('update')
    store.open()
    expect(store.visible).toBe(true)
    expect(store.activeNavItem).toBe('general')
  })

  it('close 关闭面板并清空搜索词（防残留）', () => {
    const store = useSettingsNavStore()
    store.open('shortcuts')
    store.searchQuery = '快捷'
    store.close()
    expect(store.visible).toBe(false)
    expect(store.searchQuery).toBe('')
  })

  it('toggle：关闭状态时打开指定 tab，打开状态时关闭', () => {
    const store = useSettingsNavStore()
    store.toggle('update')
    expect(store.visible).toBe(true)
    expect(store.activeNavItem).toBe('update')
    store.toggle()
    expect(store.visible).toBe(false)
  })

  it('setActiveNavItem / setActiveTab 直接更新导航项', () => {
    const store = useSettingsNavStore()
    store.open()
    store.setActiveNavItem('ai-assistant')
    expect(store.activeNavItem).toBe('ai-assistant')
    expect(store.activeTab).toBe('ai-assistant')
    store.setActiveTab('project')
    expect(store.activeNavItem).toBe('validation-params')
  })

  it('isOpen 与 visible 保持同步', () => {
    const store = useSettingsNavStore()
    store.open()
    expect(store.isOpen).toBe(true)
    store.close()
    expect(store.isOpen).toBe(false)
  })
})
