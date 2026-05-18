/**
 * @file theme.ts
 * @description 主题偏好管理模块 - 管理应用的深色/浅色主题切换
 * 
 * ====================================================================
 * 功能概述
 * ====================================================================
 * 1. getSystemResolvedTheme: 获取系统级别的主题偏好
 * 2. resolveThemePreference: 解析用户主题偏好（支持 'system' 自动模式）
 * 3. applyThemePreference: 应用主题偏好到 DOM
 * 4. getStoredThemePreference: 从 localStorage 读取保存的主题设置
 * 5. getThemeMediaQuery: 获取主题媒体查询对象
 * 
 * ====================================================================
 * 主题类型
 * ====================================================================
 * - ThemePreference: 用户选择的主题（light/dark/system）
 * - ResolvedTheme: 实际生效的主题（light/dark）
 * 
 * ====================================================================
 * 主题解析策略
 * ====================================================================
 * 当用户选择 'system' 时：
 * - 监听 prefers-color-scheme 媒体查询
 * - 自动跟随操作系统的主题设置
 * - 使用 window.matchMedia('(prefers-color-scheme: dark)') 检测
 * 
 * ====================================================================
 * DOM 应用机制
 * ====================================================================
 * applyThemePreference 执行以下操作：
 * - data-theme: 实际生效的主题（light/dark）
 * - data-theme-preference: 用户选择的主题（用于 CSS 选择器）
 * - color-scheme: CSS 颜色方案属性
 * 
 * 示例：
 * - 用户选择 dark: data-theme="dark", data-theme-preference="dark"
 * - 用户选择 system（系统 dark）: data-theme="dark", data-theme-preference="system"
 * 
 * ====================================================================
 * 存储机制
 * ====================================================================
 * 主题设置存储在 localStorage 的 'generalSettings' 键下：
 * - 格式: { "theme": "light" | "dark" | "system" }
 * - 默认为 'system'
 * 
 * ====================================================================
 * 服务端渲染兼容性
 * ====================================================================
 * canUseDom() 检查确保在非浏览器环境下的安全降级：
 * - SSR: 返回 'light'
 * - 无 localStorage: 返回 'system'
 * 
 * ====================================================================
 * 架构设计
 * ====================================================================
 * - 纯函数设计，无状态依赖
 * - 依赖注入 localStorage 和 window.matchMedia
 * - SSR 友好的空值检查
 * 
 * ====================================================================
 * CSS 变量使用示例
 * ====================================================================
 * 在 CSS 中可以根据主题选择样式：
 * 
 * 示例 1 - 默认浅色主题：
 *   .card {
 *     background: white;
 *     color: black;
 *   }
 * 
 * 示例 2 - 深色主题覆盖：
 *   [data-theme-preference="dark"] .card {
 *     background: #1e1e1e;
 *     color: white;
 *   }
 * 
 * ====================================================================
 * 注意事项
 * ====================================================================
 * - 修改 localStorage 后需要调用 applyThemePreference 生效
 * - 主题变更时需要重新查询 DOM 元素
 * - 某些 CSS 框架可能需要额外处理
 * 
 * ====================================================================
 * 依赖说明
 * ====================================================================
 * - localStorage: 浏览器本地存储
 * - window.matchMedia: 媒体查询 API
 * - document.documentElement: HTML 根元素
 * 
 * ====================================================================
 * 副作用说明
 * ====================================================================
 * - applyThemePreference: 修改 DOM 属性
 * - getStoredThemePreference: 读取 localStorage
 * 
 * @module core/utils
 */

export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

const THEME_STORAGE_KEY = 'generalSettings'
const MEDIA_QUERY = '(prefers-color-scheme: dark)'

function canUseDom(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined'
}

export function getSystemResolvedTheme(): ResolvedTheme {
  if (!canUseDom()) {
    return 'light'
  }

  return window.matchMedia(MEDIA_QUERY).matches ? 'dark' : 'light'
}

export function resolveThemePreference(theme: ThemePreference): ResolvedTheme {
  if (theme === 'system') {
    return getSystemResolvedTheme()
  }

  return theme
}

export function applyThemePreference(theme: ThemePreference): ResolvedTheme {
  const resolvedTheme = resolveThemePreference(theme)

  if (!canUseDom()) {
    return resolvedTheme
  }

  const root = document.documentElement
  root.setAttribute('data-theme', resolvedTheme)
  root.setAttribute('data-theme-preference', theme)
  root.style.colorScheme = resolvedTheme

  return resolvedTheme
}

export function getStoredThemePreference(): ThemePreference {
  if (typeof window === 'undefined') {
    return 'system'
  }

  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)

    if (!stored) {
      return 'system'
    }

    const parsed = JSON.parse(stored) as { theme?: ThemePreference }
    return parsed.theme ?? 'system'
  } catch {
    return 'system'
  }
}

export function getThemeMediaQuery(): MediaQueryList | null {
  if (!canUseDom()) {
    return null
  }

  return window.matchMedia(MEDIA_QUERY)
}
