/**
 * @file feedbackApi.ts
 * @description 崩溃反馈能力抽象层
 *
 * 设计目标:
 * - 提供统一的崩溃日志持久化、反馈导出、pending crash 读取、日志尾部读取接口
 * - Electron 下走 IPC(主进程写 userData/feedback/);Web 下退化为浏览器下载 / 空操作
 * - UI 层通过能力探测控制 Electron 专属能力
 *
 * 遵循项目能力层约定(参照 updateApi.ts):业务层禁止直接访问 window.electronAPI,
 * 统一通过本能力层调用;Electron/Web 差异由适配器内部隔离。
 */

import { isElectron, getElectronAPI } from '@/core/utils/electronDetector'
import { logger } from '@/core/utils/logger'
import type { CrashReport, PendingCrash } from '@/types/feedback'

export interface FeedbackApi {
  /** 同步获取应用版本(用于报告环境字段,失败返回占位) */
  getAppVersionSync(): string
  /** 持久化崩溃日志到 userData/feedback/(保底记录) */
  persistCrashLog(report: CrashReport): Promise<void>
  /** 导出反馈文件并在文件管理器高亮(Electron)/ 触发下载(Web) */
  exportReport(report: CrashReport): Promise<void>
  /** 读取主进程日志尾部(用于详情展示) */
  readLogTail(): Promise<string>
  /** 读取渲染进程崩溃的待补弹记录(仅 Electron,异步) */
  readPendingCrash(): Promise<PendingCrash | null>
  /** 清除待补弹记录 */
  clearPendingCrash(): void
}

/** 格式化时间戳为文件名安全字符串 */
function formatTimestampForFilename(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

/** 格式化报告为下载文本(Web 导出用,与主进程格式保持一致) */
function formatReportForDownload(report: CrashReport): string {
  return [
    '===== Precis 崩溃反馈 =====',
    `应用版本: ${report.appVersion}`,
    `平台: ${report.platform}`,
    `时间: ${report.timestamp}`,
    '',
    '--- 错误信息 ---',
    `来源: ${report.source}`,
    `消息: ${report.message}`,
    report.url ? `URL: ${report.url}` : '',
    '',
    '--- 错误堆栈 ---',
    report.stack ?? '(无堆栈)',
    '',
    '============================',
  ]
    .filter((line) => line !== '')
    .join('\n')
}

/**
 * Electron 适配器:转发到 window.electronAPI.feedback.* 与 readLogs
 */
class ElectronFeedbackAdapter implements FeedbackApi {
  getAppVersionSync(): string {
    // getAppVersion 是异步 IPC,环境字段场景用占位即可;
    // 报告的 appVersion 字段在主进程导出时会用 app.getVersion() 覆盖。
    return 'electron'
  }

  async persistCrashLog(report: CrashReport): Promise<void> {
    await getElectronAPI().feedback.persistCrashLog(report)
  }

  async exportReport(report: CrashReport): Promise<void> {
    await getElectronAPI().feedback.exportReport(report)
  }

  async readLogTail(): Promise<string> {
    try {
      return await getElectronAPI().readLogs()
    } catch (e) {
      logger.error('[feedbackApi] 读取日志尾部失败:', e)
      return ''
    }
  }

  async readPendingCrash(): Promise<PendingCrash | null> {
    try {
      return await getElectronAPI().feedback.readPendingCrash()
    } catch (e) {
      logger.error('[feedbackApi] 读取 pending crash 失败:', e)
      return null
    }
  }

  clearPendingCrash(): void {
    void getElectronAPI().feedback.clearPendingCrash()
  }
}

/**
 * Web 适配器:退化为浏览器能力
 */
class WebFeedbackAdapter implements FeedbackApi {
  getAppVersionSync(): string {
    return 'web'
  }

  async persistCrashLog(_report: CrashReport): Promise<void> {
    // Web 无本地文件系统,降级为控制台输出
    logger.warn('[feedbackApi] Web 环境:崩溃日志仅记录到控制台')
  }

  async exportReport(report: CrashReport): Promise<void> {
    const text = formatReportForDownload(report)
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `precis-feedback-${formatTimestampForFilename(report.timestamp)}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  async readLogTail(): Promise<string> {
    return ''
  }

  async readPendingCrash(): Promise<PendingCrash | null> {
    return null // Web 无渲染进程崩溃概念
  }

  clearPendingCrash(): void {
    // 空操作
  }
}

/** 根据环境选择适配器(单例) */
const adapter: FeedbackApi = isElectron() ? new ElectronFeedbackAdapter() : new WebFeedbackAdapter()

export const feedbackApi: FeedbackApi = adapter
