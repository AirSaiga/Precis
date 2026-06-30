/**
 * @file useReducedMotion.ts
 * @description 响应式检测用户「减少动态效果」系统偏好。
 *
 * 对应 CSS @media (prefers-reduced-motion: reduce)。该偏好由用户的操作系统/
 * 辅助功能设置驱动（如 macOS "减少动态效果"、Windows "显示动画"关闭）。
 *
 * 用途：对 SMIL / Web Animations 等不受 CSS animation-* 属性影响的动效做门控。
 * 现有 animations.css 的 @media 规则只压制 CSS animation/transition，无法覆盖
 * SMIL（<animate> / <animateMotion>），因此这类动效需在 JS 侧显式判断。
 *
 * 设计：
 * - 组合式函数模式，在组件 setup 中调用，返回响应式 ref<boolean>。
 * - SSR/无 DOM 环境下安全降级为 false（不开启减少动态）。
 * - 组件卸载时自动移除监听器，避免泄漏。
 *
 * @example
 * const reducedMotion = useReducedMotion()
 * // 模板中：<animateMotion v-if="!reducedMotion" />
 */

import { onBeforeUnmount, ref } from 'vue'

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

/**
 * 响应式检测「减少动态效果」偏好。
 * @returns ref，true 表示用户已请求减少动态效果。
 */
export function useReducedMotion() {
  const reducedMotion = ref(false)

  // SSR 或无 matchMedia 环境下保持 false（安全降级）
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return reducedMotion
  }

  const mediaQuery = window.matchMedia(REDUCED_MOTION_QUERY)
  reducedMotion.value = mediaQuery.matches

  const handleChange = (event: MediaQueryListEvent) => {
    reducedMotion.value = event.matches
  }

  // 优先使用 addEventListener（现代浏览器），回退 deprecated addListener
  if (typeof mediaQuery.addEventListener === 'function') {
    mediaQuery.addEventListener('change', handleChange)
    onBeforeUnmount(() => mediaQuery.removeEventListener('change', handleChange))
  } else if (typeof (mediaQuery as MediaQueryList).addListener === 'function') {
    // 兼容旧 Safari (<14)
    mediaQuery.addListener(handleChange)
    onBeforeUnmount(() => (mediaQuery as MediaQueryList).removeListener(handleChange))
  }

  return reducedMotion
}
