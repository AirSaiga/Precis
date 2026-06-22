/**
 * @file commandExecutor.ts
 * @description 快捷键命令执行器
 */
import { logger } from '@/core/utils/logger'
import type { Command, CommandContext, Shortcut, ShortcutEventData } from '../types'
import { platformAdapter } from '../platform'
/**
 * 命令执行结果
 */
export interface ExecuteResult {
  /**
   * 是否执行成功
   */
  success: boolean

  /**
   * 命令ID
   */
  commandId: string

  /**
   * 快捷键组合
   */
  keyCombo: string

  /**
   * 错误信息（如果执行失败）
   */
  error?: Error

  /**
   * 执行耗时（毫秒）
   */
  duration?: number
}

/**
 * 命令执行器类
 *
 * 提供命令执行的核心功能
 */
export class CommandExecutor {
  private registry: {
    getCommand: (commandId: string) => Command | undefined
    getCommandShortcut: (command: Command) => Shortcut
    isDisabled: (commandId: string) => boolean
  }

  private context: CommandContext

  private eventHandlers: Map<string, Set<(data: ShortcutEventData) => void>>

  private executionHistory: ExecuteResult[]

  private maxHistoryLength: number

  /**
   * 创建命令执行器实例
   *
   * @param registry 注册表实例
   * @param context 初始上下文
   * @param maxHistoryLength 最大历史记录数量
   */
  constructor(
    registry: CommandExecutor['registry'],
    context?: Partial<CommandContext>,
    maxHistoryLength = 50
  ) {
    this.registry = registry
    this.context = {
      activeComponent: context?.activeComponent ?? null,
      showFeedback: context?.showFeedback ?? true,
      ...context,
    }
    this.eventHandlers = new Map()
    this.executionHistory = []
    this.maxHistoryLength = maxHistoryLength
  }

  /**
   * 执行命令
   *
   * @param commandId 要执行的命令ID
   * @param context 额外的上下文数据
   * @returns 执行结果
   */
  async execute(commandId: string, context?: Partial<CommandContext>): Promise<ExecuteResult> {
    const startTime = performance.now()

    const command = this.registry.getCommand(commandId)
    if (!command) {
      const result: ExecuteResult = {
        success: false,
        commandId,
        keyCombo: '',
        error: new Error(`Command "${commandId}" not found`),
      }
      this.addToHistory(result)
      return result
    }

    if (this.registry.isDisabled(commandId)) {
      const result: ExecuteResult = {
        success: false,
        commandId,
        keyCombo: '',
        error: new Error(`Command "${commandId}" is disabled`),
      }
      this.addToHistory(result)
      return result
    }

    const shortcut = this.registry.getCommandShortcut(command)
    const keyCombo = platformAdapter.formatShortcut(shortcut)

    if (command.isAvailable) {
      const isAvailableResult = command.isAvailable(this.context)
      const isAvailable =
        isAvailableResult instanceof Promise ? await isAvailableResult : isAvailableResult

      if (!isAvailable) {
        logger.debug(`[CommandExecutor] Command "${commandId}" is not available`)
        const result: ExecuteResult = {
          success: false,
          commandId,
          keyCombo,
          error: new Error(`Command "${commandId}" is not available`),
        }
        this.addToHistory(result)
        return result
      }
    }

    try {
      const mergedContext: CommandContext = {
        ...this.context,
        ...context,
        showFeedback: context?.showFeedback ?? this.context.showFeedback,
      }

      await command.execute(mergedContext)

      const executeResult: ExecuteResult = {
        success: true,
        commandId,
        keyCombo,
        duration: performance.now() - startTime,
      }

      this.addToHistory(executeResult)
      this.emit('shortcut', {
        originalEvent: new KeyboardEvent('keydown'),
        shortcut,
        keyCombo,
        commandId,
        executed: true,
      })

      return executeResult
    } catch (error) {
      const executeResult: ExecuteResult = {
        success: false,
        commandId,
        keyCombo,
        error: error instanceof Error ? error : new Error(String(error)),
        duration: performance.now() - startTime,
      }

      this.addToHistory(executeResult)
      this.emit('shortcut', {
        originalEvent: new KeyboardEvent('keydown'),
        shortcut,
        keyCombo,
        commandId,
        executed: false,
        error: executeResult.error,
      })

      return executeResult
    }
  }

  /**
   * 同步执行命令
   *
   * @param commandId 要执行的命令ID
   * @param context 额外的上下文数据
   * @returns 执行结果
   */
  executeSync(commandId: string, context?: Partial<CommandContext>): ExecuteResult {
    const startTime = performance.now()

    const command = this.registry.getCommand(commandId)
    if (!command) {
      const result: ExecuteResult = {
        success: false,
        commandId,
        keyCombo: '',
        error: new Error(`Command "${commandId}" not found`),
      }
      this.addToHistory(result)
      return result
    }

    if (this.registry.isDisabled(commandId)) {
      const result: ExecuteResult = {
        success: false,
        commandId,
        keyCombo: '',
        error: new Error(`Command "${commandId}" is disabled`),
      }
      this.addToHistory(result)
      return result
    }

    const shortcut = this.registry.getCommandShortcut(command)
    const keyCombo = platformAdapter.formatShortcut(shortcut)

    if (command.isAvailable && !command.isAvailable(this.context)) {
      const result: ExecuteResult = {
        success: false,
        commandId,
        keyCombo,
        error: new Error(`Command "${commandId}" is not available`),
      }
      this.addToHistory(result)
      return result
    }

    try {
      const mergedContext: CommandContext = {
        ...this.context,
        ...context,
        showFeedback: context?.showFeedback ?? this.context.showFeedback,
      }

      const syncResult = command.execute(mergedContext)

      if (syncResult instanceof Promise) {
        logger.warn(
          `[CommandExecutor] Command "${commandId}" returned a Promise, use execute() instead`
        )
      }

      const executeResult: ExecuteResult = {
        success: true,
        commandId,
        keyCombo,
        duration: performance.now() - startTime,
      }

      this.addToHistory(executeResult)
      return executeResult
    } catch (error) {
      const executeResult: ExecuteResult = {
        success: false,
        commandId,
        keyCombo,
        error: error instanceof Error ? error : new Error(String(error)),
        duration: performance.now() - startTime,
      }

      this.addToHistory(executeResult)
      return executeResult
    }
  }

  /**
   * 更新上下文
   *
   * @param context 要更新的上下文数据
   */
  updateContext(context: Partial<CommandContext>): void {
    this.context = {
      ...this.context,
      ...context,
    }
  }

  /**
   * 获取当前上下文
   *
   * @returns 当前上下文
   */
  getContext(): Readonly<CommandContext> {
    return Object.freeze(this.context)
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
   * 获取执行历史
   *
   * @returns 执行历史记录
   */
  getHistory(): ReadonlyArray<ExecuteResult> {
    return Object.freeze(this.executionHistory.slice())
  }

  /**
   * 清空执行历史
   */
  clearHistory(): void {
    this.executionHistory = []
  }

  /**
   * 获取最近的执行结果
   *
   * @param count 获取数量
   * @returns 最近的执行结果数组
   */
  getRecentResults(count: number = 10): ReadonlyArray<ExecuteResult> {
    return Object.freeze(this.executionHistory.slice(-count))
  }

  /**
   * 添加到历史记录
   *
   * @param result 执行结果
   */
  private addToHistory(result: ExecuteResult): void {
    this.executionHistory.push(result)

    while (this.executionHistory.length > this.maxHistoryLength) {
      this.executionHistory.shift()
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
          logger.error(`[CommandExecutor] Event handler error:`, error)
        }
      }
    }
  }

  /**
   * 获取历史记录长度
   */
  get historyLength(): number {
    return this.executionHistory.length
  }
}

export default CommandExecutor
