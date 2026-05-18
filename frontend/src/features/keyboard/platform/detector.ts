/**
 * @file detector.ts
 * @description 操作系统平台检测器
 */
import type { Platform, PlatformInfo } from '../types'

/**
 * 检测当前操作系统平台
 *
 * 通过多种方式检测用户当前使用的操作系统
 * @returns 平台类型
 */
export function detectPlatform(): Platform {
  const platform = navigator.platform.toLowerCase()

  if (platform.includes('mac') || platform.includes('iphone') || platform.includes('ipad')) {
    return 'mac'
  }

  if (platform.includes('win')) {
    return 'windows'
  }

  if (platform.includes('linux') && !platform.includes('android')) {
    return 'linux'
  }

  return 'unknown'
}

/**
 * 检测是否为 Mac 系统
 *
 * 包括 macOS、iOS 设备
 * @returns 是否为 Mac 系统
 */
export function isMac(): boolean {
  return detectPlatform() === 'mac'
}

/**
 * 检测是否为 Windows 系统
 *
 * @returns 是否为 Windows 系统
 */
export function isWindows(): boolean {
  return detectPlatform() === 'windows'
}

/**
 * 检测是否为 Linux 系统
 *
 * @returns 是否为 Linux 系统
 */
export function isLinux(): boolean {
  return detectPlatform() === 'linux'
}

/**
 * 获取平台显示名称
 *
 * @param platform 平台类型
 * @returns 平台显示名称
 */
export function getPlatformDisplayName(platform: Platform): string {
  switch (platform) {
    case 'mac':
      return 'macOS'
    case 'windows':
      return 'Windows'
    case 'linux':
      return 'Linux'
    default:
      return 'Unknown'
  }
}

/**
 * 获取完整的平台信息对象
 *
 * @returns 包含所有平台信息的对象
 */
export function getPlatformInfo(): PlatformInfo {
  const platform = detectPlatform()

  return {
    type: platform,
    isMac: platform === 'mac',
    isWindows: platform === 'windows',
    isLinux: platform === 'linux',
    displayName: getPlatformDisplayName(platform)
  }
}

/**
 * 获取主要修饰键
 *
 * 根据平台返回主要修饰键
 * - Mac: Command (meta) 键
 * - Windows/Linux: Ctrl 键
 *
 * @returns 主要修饰键名称
 */
export function getPrimaryModifierKey(): 'ctrl' | 'meta' {
  return isMac() ? 'meta' : 'ctrl'
}

/**
 * 获取次要修饰键
 *
 * 根据平台返回次要修饰键
 * - Mac: Control 键
 * - Windows: Alt 键
 *
 * @returns 次要修饰键名称
 */
export function getSecondaryModifierKey(): 'ctrl' | 'alt' {
  return isMac() ? 'ctrl' : 'alt'
}

/**
 * 检测键盘布局
 *
 * @returns 键盘布局类型
 */
export function detectKeyboardLayout(): 'ansi' | 'iso' | 'jis' {
  if (typeof navigator === 'undefined') {
    return 'ansi'
  }

  const language = navigator.language

  if (language.startsWith('ja')) {
    return 'jis'
  }

  if (language.startsWith('zh')) {
    return 'jis'
  }

  return 'ansi'
}

/**
 * 检测是否有功能键
 *
 * @returns 是否有 F1-F12 功能键
 */
export function hasFunctionKeys(): boolean {
  return true
}

/**
 * 导出单例对象
 */
export const platformDetector = {
  detectPlatform,
  isMac,
  isWindows,
  isLinux,
  getPlatformDisplayName,
  getPlatformInfo,
  getPrimaryModifierKey,
  getSecondaryModifierKey,
  detectKeyboardLayout,
  hasFunctionKeys
}

export default platformDetector
