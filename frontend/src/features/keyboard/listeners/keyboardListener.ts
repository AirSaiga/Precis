/**
 * @file keyboardListener.ts
 * @description 全局键盘事件监听器
 *
 * 功能概述：
 * - 全局键盘事件的捕获与分发
 * - 快捷键组合解析与事件触发
 * - 忽略输入框等元素的键盘事件
 * - 项目管理中心快捷键特殊处理
 */

import { logger } from '@/core/utils/logger'
import { eventBus } from '@/core/eventBus'
import type { KeyboardListener, KeyboardListenerConfig, ShortcutEventData } from '../types'
import { DEFAULT_LISTENER_CONFIG, IGNORED_KEYS } from '../constants'
import { platformAdapter } from '../platform'

/**
 * 键盘事件监听器类
 *
 * 提供键盘事件的全局监听和分发功能
 */
export class KeyboardListenerImpl implements KeyboardListener {
  private config: KeyboardListenerConfig
  private isActive: boolean
  private boundHandler: ((event: KeyboardEvent) => void) | null = null
  private eventHandlers: Map<string, Set<(data: ShortcutEventData) => void>>

  private executor: {
    execute: (commandId: string) => Promise<{ success: boolean }>
    on: (event: string, handler: (data: ShortcutEventData) => void) => void
    off: (event: string, handler: (data: ShortcutEventData) => void) => void
  }

  /**
   * 创建键盘监听器实例
   *
   * @param executor 命令执行器实例
   * @param config 监听配置
   */
  constructor(
    executor: KeyboardListenerImpl['executor'],
    config?: Partial<KeyboardListenerConfig>
  ) {
    this.executor = executor
    this.config = {
      scope: config?.scope ?? DEFAULT_LISTENER_CONFIG.scope,
      when: config?.when,
      ignoreInput: config?.ignoreInput ?? DEFAULT_LISTENER_CONFIG.ignoreInput,
      preventDefault: config?.preventDefault ?? DEFAULT_LISTENER_CONFIG.preventDefault,
      stopPropagation: config?.stopPropagation ?? DEFAULT_LISTENER_CONFIG.stopPropagation,
    }
    this.isActive = false
    this.eventHandlers = new Map()

    this.boundHandler = this.handleKeydown.bind(this)
  }

  /**
   * 开始监听键盘事件
   */
  start(): void {
    if (this.isActive) {
      return
    }

    if (this.boundHandler) {
      document.addEventListener('keydown', this.boundHandler)
    }
    this.isActive = true
  }

  /**
   * 停止监听键盘事件
   */
  stop(): void {
    if (!this.isActive) {
      return
    }

    if (this.boundHandler) {
      document.removeEventListener('keydown', this.boundHandler)
    }
    this.isActive = false
  }

  /**
   * 注册监听配置
   *
   * @param config 监听配置
   */
  register(config: Partial<KeyboardListenerConfig>): void {
    this.config = {
      scope: config.scope ?? this.config.scope,
      when: config.when ?? this.config.when,
      ignoreInput: config.ignoreInput ?? this.config.ignoreInput,
      preventDefault: config.preventDefault ?? this.config.preventDefault,
      stopPropagation: config.stopPropagation ?? this.config.stopPropagation,
    }
  }

  /**
   * 注销监听配置
   */
  unregister(): void {
    this.config = {
      scope: DEFAULT_LISTENER_CONFIG.scope,
      ignoreInput: DEFAULT_LISTENER_CONFIG.ignoreInput,
      preventDefault: DEFAULT_LISTENER_CONFIG.preventDefault,
      stopPropagation: DEFAULT_LISTENER_CONFIG.stopPropagation,
    }
  }

  /**
   * 注册事件监听器
   *
   * @param event 事件名称
   * @param handler 事件处理函数
   */
  on(event: 'shortcut', handler: (data: ShortcutEventData) => void): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set())
    }
    this.eventHandlers.get(event)!.add(handler)
  }

  /**
   * 移除事件监听器
   *
   * @param event 事件名称
   * @param handler 事件处理函数
   */
  off(event: 'shortcut', handler: (data: ShortcutEventData) => void): void {
    const handlers = this.eventHandlers.get(event)
    if (handlers) {
      handlers.delete(handler)
    }
  }

  /**
   * 获取监听器是否处于活动状态
   *
   * @returns 是否活动
   */
  get active(): boolean {
    return this.isActive
  }

  /**
   * 获取当前配置
   *
   * @returns 当前配置
   */
  getConfig(): Readonly<KeyboardListenerConfig> {
    return Object.freeze({ ...this.config })
  }

  /**
   * 处理键盘事件
   *
   * @param event 键盘事件
   */
  private async handleKeydown(event: KeyboardEvent): Promise<void> {
    // 调试日志：追踪 Enter 相关按键事件
    if (event.key === 'Enter') {
      const target = event.target as HTMLElement | null
      logger.debug(
        `[KeyboardListener] Enter key detected — ctrl: ${event.ctrlKey}, meta: ${event.metaKey}, ` +
          `target: ${target?.tagName || 'null'}, ignored: ${this.isIgnoredElement(event)}`
      )
    }

    if (this.config.when && !this.config.when()) {
      return
    }

    if (this.isIgnoredElement(event)) {
      return
    }

    if (IGNORED_KEYS.has(event.key)) {
      return
    }

    if (event.repeat) {
      return
    }

    if (this.handleProjectManagementShortcut(event)) {
      return
    }

    const shortcut = this.createShortcutFromEvent(event)
    const keyCombo = platformAdapter.formatShortcut(shortcut)

    const eventData: ShortcutEventData = {
      originalEvent: event,
      shortcut,
      keyCombo,
      commandId: '',
      executed: false,
    }

    this.emit('shortcut', eventData)

    if (eventData.executed) {
      if (this.config.preventDefault) {
        event.preventDefault()
      }
      if (this.config.stopPropagation) {
        event.stopPropagation()
      }
    }
  }

  /**
   * 处理项目管理中心快捷键 (Ctrl+Shift+P / Cmd+Shift+P)
   *
   * @param event 键盘事件
   * @returns 是否处理了该快捷键
   */
  private handleProjectManagementShortcut(event: KeyboardEvent): boolean {
    const isPKey = event.key.toLowerCase() === 'p'
    const hasShift = event.shiftKey
    const hasCtrlOrMeta = event.ctrlKey || event.metaKey

    if (isPKey && hasShift && hasCtrlOrMeta) {
      event.preventDefault()
      eventBus.emit('open-project-management')
      return true
    }

    return false
  }

  /**
   * 检查是否为忽略的元素
   *
   * @param event 键盘事件
   * @returns 是否为忽略的元素
   */
  private isIgnoredElement(event: KeyboardEvent): boolean {
    if (!this.config.ignoreInput) {
      return false
    }

    const target = event.target as HTMLElement

    if (!target) {
      return false
    }

    const tagName = target.tagName.toLowerCase()

    if (tagName === 'input') {
      const inputType = (target as HTMLInputElement).type.toLowerCase()
      const ignoredTypes = ['text', 'email', 'password', 'search', 'tel', 'url']
      if (!ignoredTypes.includes(inputType)) {
        return false
      }
      return true
    }

    if (tagName === 'textarea') {
      return true
    }

    if (target.isContentEditable) {
      return true
    }

    return false
  }

  /**
   * 从键盘事件创建快捷键对象
   *
   * @param event 键盘事件
   * @returns 快捷键对象
   */
  private createShortcutFromEvent(event: KeyboardEvent) {
    return {
      key: event.key,
      ctrl: event.ctrlKey,
      meta: event.metaKey,
      shift: event.shiftKey,
      alt: event.altKey,
    }
  }

  /**
   * 触发事件
   *
   * @param event 事件名称
   * @param data 事件数据
   */
  private emit(event: string, data: ShortcutEventData): void {
    const handlers = this.eventHandlers.get(event)
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(data)
        } catch (error) {
          logger.error('[KeyboardListener] Event handler error:', error)
        }
      }
    }
  }

  /**
   * 销毁监听器
   */
  destroy(): void {
    this.stop()
    this.eventHandlers.clear()
    this.boundHandler = null
  }
}

export default KeyboardListenerImpl
