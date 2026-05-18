/**
 * @file shortcutRegistry.ts
 * @description 快捷键注册表管理
 */
import { logger } from '@/core/utils/logger'
import type { Command, Shortcut, ShortcutRegistryConfig, RegistryState } from '../types'
import { DEFAULT_REGISTRY_CONFIG } from '../constants'
import { platformAdapter, platformDetector } from '../platform'

/**
 * 快捷键注册表类
 *
 * 提供完整的快捷键管理功能
 */
export class ShortcutRegistry {
  private state: RegistryState
  private config: Required<ShortcutRegistryConfig>
  private conflictCallback?: (command1: Command, command2: Command) => void

  /**
   * 创建快捷键注册表实例
   *
   * @param config 注册表配置
   */
  constructor(config: ShortcutRegistryConfig = {}) {
    this.config = {
      autoRegisterDefaults:
        config.autoRegisterDefaults ?? DEFAULT_REGISTRY_CONFIG.autoRegisterDefaults,
      enablePlatformAdapter:
        config.enablePlatformAdapter ?? DEFAULT_REGISTRY_CONFIG.enablePlatformAdapter,
      conflictStrategy: config.conflictStrategy ?? DEFAULT_REGISTRY_CONFIG.conflictStrategy,
    }

    this.state = {
      commands: new Map(),
      keyBindings: new Map(),
      disabledCommands: new Set(),
    }
  }

  /**
   * 注册命令
   *
   * @param command 要注册的命令
   * @returns 是否注册成功
   */
  register(command: Command): boolean {
    if (this.state.commands.has(command.id)) {
      logger.warn(`[ShortcutRegistry] Command "${command.id}" is already registered`)
      return false
    }

    const normalizedCommand = this.normalizeCommand(command)
    this.state.commands.set(command.id, normalizedCommand)

    const shortcut = this.getCommandShortcut(normalizedCommand)
    const keyCombo = platformAdapter.formatShortcut(shortcut)

    const existingCommandId = this.state.keyBindings.get(keyCombo)
    if (existingCommandId) {
      this.handleConflict(normalizedCommand, this.state.commands.get(existingCommandId)!)
    } else {
      this.state.keyBindings.set(keyCombo, command.id)
    }

    return true
  }

  /**
   * 注销命令
   *
   * @param commandId 要注销的命令ID
   * @returns 是否注销成功
   */
  unregister(commandId: string): boolean {
    const command = this.state.commands.get(commandId)
    if (!command) {
      return false
    }

    const shortcut = this.getCommandShortcut(command)
    const keyCombo = platformAdapter.formatShortcut(shortcut)

    this.state.keyBindings.delete(keyCombo)
    this.state.commands.delete(commandId)
    this.state.disabledCommands.delete(commandId)

    return true
  }

  /**
   * 批量注册命令
   *
   * @param commands 要注册的命令数组
   * @returns 注册成功的命令数量
   */
  registerAll(commands: Command[]): number {
    let successCount = 0

    for (const command of commands) {
      if (this.register(command)) {
        successCount++
      }
    }

    return successCount
  }

  /**
   * 清空所有注册
   */
  clear(): void {
    this.state.commands.clear()
    this.state.keyBindings.clear()
    this.state.disabledCommands.clear()
  }

  /**
   * 根据快捷键查找命令
   *
   * @param event 键盘事件
   * @returns 匹配的命令，如果未找到返回 undefined
   */
  getCommandByEvent(event: KeyboardEvent): Command | undefined {
    const isEnter = event.key === 'Enter'
    if (isEnter) {
      logger.debug(`[ShortcutRegistry] Searching command for Enter event...`)
    }
    for (const [commandId, command] of this.state.commands) {
      if (this.isDisabled(commandId)) {
        continue
      }

      const shortcut = this.getCommandShortcut(command)
      if (platformAdapter.matchesShortcut(event, shortcut)) {
        if (isEnter) {
          logger.debug(
            `[ShortcutRegistry] Matched command: ${commandId}, shortcut: ${platformAdapter.formatShortcut(shortcut)}`
          )
        }
        return command
      }
    }
    if (isEnter) {
      logger.debug(`[ShortcutRegistry] No command matched for Enter event`)
    }
    return undefined
  }

  /**
   * 根据快捷键字符串查找命令
   *
   * @param keyCombo 快捷键字符串
   * @returns 匹配的命令，如果未找到返回 undefined
   */
  getCommandByKeyCombo(keyCombo: string): Command | undefined {
    const normalizedCombo = keyCombo.toLowerCase()
    const commandId = this.state.keyBindings.get(normalizedCombo)

    if (!commandId) {
      return undefined
    }

    return this.state.commands.get(commandId)
  }

  /**
   * 根据命令ID获取命令
   *
   * @param commandId 命令ID
   * @returns 命令对象，如果未找到返回 undefined
   */
  getCommand(commandId: string): Command | undefined {
    return this.state.commands.get(commandId)
  }

  /**
   * 获取所有命令
   *
   * @returns 所有已注册的命令数组
   */
  getAllCommands(): Command[] {
    return Array.from(this.state.commands.values())
  }

  /**
   * 获取所有命令ID
   *
   * @returns 所有已注册的命令ID数组
   */
  getAllCommandIds(): string[] {
    return Array.from(this.state.commands.keys())
  }

  /**
   * 获取命令的当前平台快捷键
   *
   * @param command 命令对象
   * @returns 当前平台的快捷键
   */
  getCommandShortcut(command: Command): Shortcut {
    if (this.config.enablePlatformAdapter) {
      return platformAdapter.getPlatformShortcut(command.defaultShortcut, command.platformVariants)
    }
    return command.defaultShortcut
  }

  /**
   * 获取快捷键字符串到命令ID的映射
   *
   * @returns 快捷键映射
   */
  getKeyBindings(): Map<string, string> {
    return new Map(this.state.keyBindings)
  }

  /**
   * 禁用命令
   *
   * @param commandId 要禁用的命令ID
   * @returns 是否禁用成功
   */
  disable(commandId: string): boolean {
    if (!this.state.commands.has(commandId)) {
      return false
    }

    this.state.disabledCommands.add(commandId)
    return true
  }

  /**
   * 启用命令
   *
   * @param commandId 要启用的命令ID
   * @returns 是否启用成功
   */
  enable(commandId: string): boolean {
    return this.state.disabledCommands.delete(commandId)
  }

  /**
   * 检查命令是否被禁用
   *
   * @param commandId 命令ID
   * @returns 是否被禁用
   */
  isDisabled(commandId: string): boolean {
    return this.state.disabledCommands.has(commandId)
  }

  /**
   * 批量禁用命令
   *
   * @param commandIds 要禁用的命令ID数组
   */
  disableAll(commandIds: string[]): void {
    for (const commandId of commandIds) {
      this.disable(commandId)
    }
  }

  /**
   * 启用所有命令
   */
  enableAll(): void {
    this.state.disabledCommands.clear()
  }

  /**
   * 设置冲突处理回调
   *
   * @param callback 冲突处理回调函数
   */
  onConflict(callback: (command1: Command, command2: Command) => void): void {
    this.conflictCallback = callback
  }

  /**
   * 获取注册表状态
   *
   * @returns 当前状态快照
   */
  getState(): Readonly<RegistryState> {
    return Object.freeze({
      commands: new Map(this.state.commands),
      keyBindings: new Map(this.state.keyBindings),
      disabledCommands: new Set(this.state.disabledCommands),
    })
  }

  /**
   * 获取注册的命令数量
   *
   * @returns 命令数量
   */
  get size(): number {
    return this.state.commands.size
  }

  /**
   * 获取已禁用的命令数量
   *
   * @returns 禁用数量
   */
  get disabledCount(): number {
    return this.state.disabledCommands.size
  }

  /**
   * 标准化命令对象
   *
   * @param command 原始命令
   * @returns 标准化后的命令
   */
  private normalizeCommand(command: Command): Command {
    return {
      ...command,
      priority: command.priority ?? 0,
      isDisabled: command.isDisabled ?? false,
    }
  }

  /**
   * 处理快捷键冲突
   *
   * @param command1 第一个命令
   * @param command2 第二个命令
   */
  private handleConflict(command1: Command, command2: Command): void {
    const shortcut1 = platformAdapter.formatShortcut(this.getCommandShortcut(command1))
    const shortcut2 = platformAdapter.formatShortcut(this.getCommandShortcut(command2))

    switch (this.config.conflictStrategy) {
      case 'error':
        throw new Error(
          `[ShortcutRegistry] Shortcut conflict: "${shortcut1}" is already used by "${command2.id}"`
        )

      case 'override':
        this.state.keyBindings.set(shortcut1, command1.id)
        logger.warn(
          `[ShortcutRegistry] Shortcut conflict resolved by override: "${shortcut1}" -> "${command1.id}"`
        )
        break

      case 'warn':
      default:
        logger.warn(
          `[ShortcutRegistry] Shortcut conflict detected: "${shortcut1}" is used by both "${command1.id}" and "${command2.id}". Using "${command2.id}".`
        )
        break
    }

    if (this.conflictCallback) {
      this.conflictCallback(command1, command2)
    }
  }

  /**
   * 导出注册表数据（用于持久化）
   *
   * @returns 导出的数据对象
   */
  export(): { commands: Command[]; disabledCommands: string[] } {
    return {
      commands: this.getAllCommands(),
      disabledCommands: Array.from(this.state.disabledCommands),
    }
  }

  /**
   * 从数据导入注册表
   *
   * @param data 要导入的数据
   */
  import(data: { commands: Command[]; disabledCommands: string[] }): void {
    this.clear()

    for (const command of data.commands) {
      this.register(command)
    }

    for (const commandId of data.disabledCommands) {
      this.disable(commandId)
    }
  }
}

export default ShortcutRegistry
