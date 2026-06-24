/**
 * @file feedback.ts
 * @description 崩溃反馈相关类型定义
 */

/** 崩溃来源 */
export type CrashSource = 'renderer' | 'main-process' | 'unhandled-rejection'

/** 崩溃报告(贯穿捕获 → 汇聚 → 展示全流程) */
export interface CrashReport {
  /** UUID */
  id: string
  /** ISO8601 时间戳 */
  timestamp: string
  /** 崩溃来源 */
  source: CrashSource
  /** 错误指纹(会话内去重用) */
  fingerprint: string
  /** 错误消息 */
  message: string
  /** 错误堆栈(可选) */
  stack?: string
  /** 应用版本 */
  appVersion: string
  /** 操作系统平台 */
  platform: string
  /** renderer 错误发生的页面 URL(可选) */
  url?: string
  /** Vue errorHandler 的 info 字段(可选) */
  componentInfo?: string
}

/** 捕获层向 store 提交的原始错误信息(未补全环境字段) */
export interface ErrorInfo {
  source: CrashSource
  message: string
  stack?: string
  url?: string
  componentInfo?: string
}

/** 渲染进程崩溃时主进程写入的待补弹记录 */
export interface PendingCrash {
  source: 'main-process'
  message: string
  timestamp: string
  exitCode?: number
}
