/**
 * @file i18n.ts
 * @description 主进程用户可见文案的 i18n（原生对话框 / IPC 错误返回 / 反馈文件头）
 *
 * 语言来源（两级）：
 * 1. 初始值取 OS locale（app.getLocale()）——覆盖 splash 阶段与渲染进程设置同步前的窗口期
 * 2. 渲染进程启动/切换语言后经 `app:set-locale` IPC 同步用户设置并覆盖（见 ipc/appLocale.ts）
 *
 * 范围约定：仅覆盖"用户可见"文案；logger 日志属开发者诊断信息，保留中文不翻译。
 */

import { app } from 'electron';

export type AppLocale = 'zh-CN' | 'en-US';

let currentLocale: AppLocale | null = null;

/**
 * 获取当前语言（惰性初始化：首次调用取 OS locale）
 *
 * app.getLocale() 官方建议在 ready 后调用；首个 t() 调用发生在对话框弹出时，
 * 此时 app 必然已 ready，因此惰性取值是安全的。
 */
export function getAppLocale(): AppLocale {
  if (!currentLocale) {
    const osLocale = (app.getLocale?.() ?? '').toLowerCase();
    currentLocale = osLocale.startsWith('zh') ? 'zh-CN' : 'en-US';
  }
  return currentLocale;
}

/**
 * 渲染进程同步语言设置（仅接受已知取值，未知值忽略保持现状）
 */
export function setAppLocale(locale: string): void {
  if (locale === 'zh-CN' || locale === 'en-US') {
    currentLocale = locale;
  }
}

type MessageParams = Record<string, string | number>;

// 文案目录。key 前缀按使用场景分组：
// dialog.* 原生对话框；fs.* 文件 IPC 错误返回（渲染进程展示）；crash.* 崩溃弹窗与 pending 记录；feedback.* 反馈文件头
const messages: Record<AppLocale, Record<string, string>> = {
  'zh-CN': {
    'dialog.backendStartFailedTitle': '后端服务启动失败',
    'dialog.backendStartFailedDetail':
      'Precis 无法启动本地后端服务，应用将无法使用。\n\n错误信息：{error}\n\n请尝试以下步骤：\n1. 检查是否有安全软件阻止了应用运行；\n2. 重新安装应用；\n3. 如问题持续，请将日志文件发送给开发团队。\n\n日志位置：{logPath}',
    'dialog.selectFile': '选择文件',
    'dialog.selectButton': '选择',
    'dialog.reselectFile': '重新选择文件',
    'dialog.confirmButton': '确认',
    'fs.invalidPath': '无效的文件路径',
    'fs.pathMustBeAbsolute': '路径必须是绝对路径',
    'fs.pathOutsideAllowed': '路径不在允许的目录范围内',
    'fs.fileTypeNotAllowed': '不允许打开此类型文件（{ext}）',
    'fs.noExtension': '无扩展名',
    'fs.fileNotFound': '文件不存在',
    'fs.unknownError': '未知错误',
    'update.noUpdateAvailable': '没有可用的更新',
    'update.downloadFailed': '下载失败',
    'update.downloadNotComplete': '更新未下载完成',
    'crash.rendererGonePending': '渲染进程意外退出 ({reason})',
    'crash.title': '应用遇到问题',
    'crash.message': '渲染进程意外退出',
    'crash.detail': '原因: {reason}\n崩溃记录已保存,重启后将提示您导出反馈。',
    'crash.restartButton': '重启应用',
    'crash.quitButton': '退出',
    'feedback.reportHeader': '===== Precis 崩溃反馈 =====',
    'feedback.appVersion': '应用版本',
    'feedback.platform': '平台',
    'feedback.time': '时间',
    'feedback.errorInfo': '--- 错误信息 ---',
    'feedback.source': '来源',
    'feedback.message': '消息',
    'feedback.errorStack': '--- 错误堆栈 ---',
    'feedback.noStack': '(无堆栈)',
    'feedback.mainLogTail': '--- 主进程日志尾部 ---',
  },
  'en-US': {
    'dialog.backendStartFailedTitle': 'Backend Service Failed to Start',
    'dialog.backendStartFailedDetail':
      'Precis could not start the local backend service, so the app cannot be used.\n\nError: {error}\n\nPlease try the following:\n1. Check whether security software is blocking the app;\n2. Reinstall the app;\n3. If the problem persists, send the log file to the development team.\n\nLog location: {logPath}',
    'dialog.selectFile': 'Select File',
    'dialog.selectButton': 'Select',
    'dialog.reselectFile': 'Reselect File',
    'dialog.confirmButton': 'Confirm',
    'fs.invalidPath': 'Invalid file path',
    'fs.pathMustBeAbsolute': 'Path must be absolute',
    'fs.pathOutsideAllowed': 'Path is outside the allowed directory scope',
    'fs.fileTypeNotAllowed': 'This file type is not allowed to open ({ext})',
    'fs.noExtension': 'no extension',
    'fs.fileNotFound': 'File not found',
    'fs.unknownError': 'Unknown error',
    'update.noUpdateAvailable': 'No update available',
    'update.downloadFailed': 'Download failed',
    'update.downloadNotComplete': 'Update has not finished downloading',
    'crash.rendererGonePending': 'Renderer process exited unexpectedly ({reason})',
    'crash.title': 'Application Problem',
    'crash.message': 'The renderer process exited unexpectedly',
    'crash.detail':
      'Reason: {reason}\nA crash report has been saved. You will be prompted to export feedback after restart.',
    'crash.restartButton': 'Restart',
    'crash.quitButton': 'Quit',
    'feedback.reportHeader': '===== Precis Crash Report =====',
    'feedback.appVersion': 'App Version',
    'feedback.platform': 'Platform',
    'feedback.time': 'Time',
    'feedback.errorInfo': '--- Error Info ---',
    'feedback.source': 'Source',
    'feedback.message': 'Message',
    'feedback.errorStack': '--- Stack Trace ---',
    'feedback.noStack': '(no stack)',
    'feedback.mainLogTail': '--- Main Process Log Tail ---',
  },
};

/**
 * 取文案：当前语言缺失时回退 zh-CN，再缺失返回 key 本身（便于发现漏配）
 */
export function t(key: string, params?: MessageParams): string {
  const locale = getAppLocale();
  let text = messages[locale][key] ?? messages['zh-CN'][key] ?? key;
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      // split/join 而非 replaceAll（electron tsconfig lib 低于 es2021）
      text = text.split(`{${name}}`).join(String(value));
    }
  }
  return text;
}
