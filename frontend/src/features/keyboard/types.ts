/**
 * @file types.ts
 * @description 快捷键类型定义
 */
import type { ComponentInternalInstance } from 'vue'

/**
 * 快捷键组合结构
 *
 * 定义一个完整的键盘快捷键组合，包含所有修饰键和主键
 * 支持跨平台标准化，适配器会自动转换 Mac 和 Windows 的差异
 */
export interface Shortcut {
  /**
   * 主键（字母键、数字键或功能键）
   * @example 's' (保存键), 'z' (撤销键), 'Delete' (删除键)
   */
  key: string

  /**
   * Ctrl 修饰键
   * - Windows: Ctrl 键
   * - Mac: Control 键（非 Command）
   * @default false
   */
  ctrl?: boolean

  /**
   * Meta 修饰键（Command 键）
   * - Mac: Command (⌘) 键
   * - Windows: Windows 键（通常不用于快捷键）
   * @default false
   */
  meta?: boolean

  /**
   * Shift 修饰键
   * @default false
   */
  shift?: boolean

  /**
   * Alt/Option 修饰键
   * @default false
   */
  alt?: boolean
}

/**
 * 快捷键命令接口
 *
 * 定义快捷键命令的完整契约，包含：
 * - 命令元数据（ID、名称、快捷键）
 * - 执行逻辑
 * - 可用性条件
 */
export interface Command {
  /**
   * 命令唯一标识符
   * 采用点分命名法：<category>.<action>
   * @example 'editor.save', 'canvas.delete', 'node.copy'
   */
  id: string

  /**
   * 命令名称的国际化键名
   * 用于在 UI 中显示命令名称
   * @example 'shortcuts.save'
   */
  name: string

  /**
   * 默认快捷键定义
   * 如果未指定平台变体，则使用此快捷键
   */
  defaultShortcut: Shortcut

  /**
   * 平台特定快捷键变体
   * 用于定义 Mac 和 Windows 不同的快捷键
   */
  platformVariants?: {
    /**
     * Mac 特定快捷键
     * 通常使用 meta (Command) 键
     */
    mac?: Shortcut

    /**
     * Windows 特定快捷键
     * 通常使用 ctrl (Ctrl) 键
     */
    windows?: Shortcut
  }

  /**
   * 命令执行逻辑
   * 返回 Promise 支持异步操作
   */
  execute: (context: CommandContext) => Promise<void> | void

  /**
   * 命令可用性条件
   * 返回 false 时命令不会执行
   * 支持同步和异步两种方式
   * @param context 命令执行上下文
   * @returns 命令是否可用
   */
  isAvailable?: (context: CommandContext) => boolean | Promise<boolean>

  /**
   * 命令是否被禁用
   * @default false
   */
  isDisabled?: boolean

  /**
   * 命令所属分类
   * 用于在 UI 中分组显示
   * @example 'editor', 'canvas', 'node', 'view'
   */
  category?: string

  /**
   * 命令优先级
   * 数字越大优先级越高
   * @default 0
   */
  priority?: number
}

/**
 * 命令执行上下文
 *
 * 描述命令执行时的环境信息
 * 包含当前应用状态、Vue组件实例等
 */
export interface CommandContext {
  /**
   * 当前活动的 Vue 组件实例
   * 用于访问组件状态和调用组件方法
   */
  activeComponent: ComponentInternalInstance | null

  /**
   * 是否显示命令反馈
   * @default true
   */
  showFeedback?: boolean

  /**
   * 附加的自定义数据
   * 特定命令可以使用此字段传递额外信息
   */
  [key: string]: unknown
}

/**
 * 快捷键注册表配置
 */
export interface ShortcutRegistryConfig {
  /**
   * 是否自动注册默认命令
   * @default true
   */
  autoRegisterDefaults?: boolean

  /**
   * 是否启用平台适配
   * @default true
   */
  enablePlatformAdapter?: boolean

  /**
   * 冲突处理策略
   * - 'error': 抛出错误
   * - 'warn': 打印警告，使用第一个注册的
   * - 'override': 使用后注册的覆盖先注册的
   * @default 'warn'
   */
  conflictStrategy?: 'error' | 'warn' | 'override'
}

/**
 * 注册表状态
 */
export interface RegistryState {
  /**
   * 所有已注册的命令
   */
  commands: Map<string, Command>

  /**
   * 快捷键到命令ID的映射
   */
  keyBindings: Map<string, string>

  /**
   * 命令是否被禁用
   */
  disabledCommands: Set<string>
}

/**
 * 快捷键监听配置
 */
export interface KeyboardListenerConfig {
  /**
   * 监听范围
   * - 'global': 全局监听
   * - 'canvas': 仅画布区域
   * - 'editor': 仅编辑器区域
   * @default 'global'
   */
  scope: 'global' | 'canvas' | 'editor'

  /**
   * 条件函数
   * 返回 true 时快捷键才生效
   */
  when?: () => boolean

  /**
   * 忽略输入元素
   * 当焦点在 input、textarea 等元素时是否忽略快捷键
   * @default true
   */
  ignoreInput?: boolean

  /**
   * 阻止默认行为
   * @default true
   */
  preventDefault?: boolean

  /**
   * 停止传播
   * @default true
   */
  stopPropagation?: boolean
}

/**
 * 快捷键事件数据
 */
export interface ShortcutEventData {
  /**
   * 原始键盘事件
   */
  originalEvent: KeyboardEvent

  /**
   * 标准化的快捷键组合
   */
  shortcut: Shortcut

  /**
   * 快捷键字符串表示
   * @example 'Ctrl+S', 'Meta+C', 'Shift+Delete'
   */
  keyCombo: string

  /**
   * 触发的命令ID
   */
  commandId: string

  /**
   * 命令执行结果
   */
  executed: boolean

  /**
   * 错误信息（如果执行失败）
   */
  error?: Error
}

/**
 * 快捷键监听器接口
 */
export interface KeyboardListener {
  /**
   * 开始监听键盘事件
   */
  start(): void

  /**
   * 停止监听键盘事件
   */
  stop(): void

  /**
   * 注册监听配置
   */
  register(config: KeyboardListenerConfig): void

  /**
   * 注销监听配置
   */
  unregister(): void

  /**
   * 事件发射器
   */
  on(event: 'shortcut', handler: (data: ShortcutEventData) => void): void

  /**
   * 移除事件监听器
   */
  off(event: 'shortcut', handler: (data: ShortcutEventData) => void): void
}

/**
 * 平台类型
 */
export type Platform = 'mac' | 'windows' | 'linux' | 'unknown'

/**
 * 平台信息接口
 */
export interface PlatformInfo {
  /**
   * 平台类型
   */
  type: Platform

  /**
   * 是否为 Mac 系统
   */
  isMac: boolean

  /**
   * 是否为 Windows 系统
   */
  isWindows: boolean

  /**
   * 是否为 Linux 系统
   */
  isLinux: boolean

  /**
   * 平台显示名称
   */
  displayName: string
}
