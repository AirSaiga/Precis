/**
 * @file animateToPosition.ts
 * @description 节点位置动画工具
 *
 * 功能概述：
 * - 提供多种缓动函数（线性、easeIn、easeOut、easeInOut）
 * - 支持单节点与批量节点位置动画
 * - 支持链式顺序动画执行
 * - 提供动画组管理与取消能力
 */

/**
 * 缓动函数 - Cubic ease-in-out
 */
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

/**
 * 缓动函数 - Linear
 */
export function easeLinear(t: number): number {
  return t
}

/**
 * 缓动函数 - Ease-in
 */
export function easeIn(t: number): number {
  return t * t
}

/**
 * 缓动函数 - Ease-out
 */
export function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 2)
}

/**
 * 单个节点位置动画
 */
export function animateNodeToPosition(
  element: HTMLElement,
  targetX: number,
  targetY: number,
  duration: number = 300
): Promise<void> {
  return new Promise((resolve) => {
    const startTransform = getComputedStyle(element).transform
    const matrix = new DOMMatrix(startTransform)
    const startX = matrix.m41
    const startY = matrix.m42

    if (startX === targetX && startY === targetY) {
      resolve()
      return
    }

    const startTime = performance.now()

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime
      const progress = Math.min(elapsed / duration, 1)
      const easedProgress = easeInOutCubic(progress)

      const currentX = startX + (targetX - startX) * easedProgress
      const currentY = startY + (targetY - startY) * easedProgress

      element.style.transform = `translate(${currentX}px, ${currentY}px)`

      if (progress < 1) {
        requestAnimationFrame(animate)
      } else {
        element.style.transform = `translate(${targetX}px, ${targetY}px)`
        resolve()
      }
    }

    requestAnimationFrame(animate)
  })
}

/**
 * 批量动画（并行执行）
 */
export async function animateAllNodes(
  nodeElements: Map<string, HTMLElement>,
  targetPositions: Map<string, { x: number; y: number }>,
  options: {
    duration: number
    stagger: number
    easing?: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut'
  }
): Promise<void> {
  const entries = Array.from(nodeElements.entries())
  const easingFn = getEasingFunction(options.easing || 'easeInOut')

  const promises = entries.map(([id, element], index) => {
    const target = targetPositions.get(id)
    if (!target) return Promise.resolve()

    const delay = index * options.stagger
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        animateElementWithEasing(element, target.x, target.y, options.duration, easingFn).then(
          resolve
        )
      }, delay)
    })
  })

  await Promise.all(promises)
}

/**
 * 获取缓动函数
 */
function getEasingFunction(
  easing: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut'
): (t: number) => number {
  switch (easing) {
    case 'linear':
      return easeLinear
    case 'easeIn':
      return easeIn
    case 'easeOut':
      return easeOut
    case 'easeInOut':
    default:
      return easeInOutCubic
  }
}

/**
 * 使用指定缓动函数的动画
 */
function animateElementWithEasing(
  element: HTMLElement,
  targetX: number,
  targetY: number,
  duration: number,
  easingFn: (t: number) => number
): Promise<void> {
  return new Promise((resolve) => {
    const startTransform = getComputedStyle(element).transform
    const matrix = new DOMMatrix(startTransform)
    const startX = matrix.m41
    const startY = matrix.m42

    if (Math.abs(startX - targetX) < 1 && Math.abs(startY - targetY) < 1) {
      resolve()
      return
    }

    const startTime = performance.now()

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime
      const progress = Math.min(elapsed / duration, 1)
      const easedProgress = easingFn(progress)

      const currentX = startX + (targetX - startX) * easedProgress
      const currentY = startY + (targetY - startY) * easedProgress

      element.style.transform = `translate(${currentX}px, ${currentY}px)`

      if (progress < 1) {
        requestAnimationFrame(animate)
      } else {
        element.style.transform = `translate(${targetX}px, ${targetY}px)`
        resolve()
      }
    }

    requestAnimationFrame(animate)
  })
}

/**
 * 链式动画（顺序执行）
 */
export async function animateNodesSequentially(
  nodeElements: Map<string, HTMLElement>,
  targetPositions: Map<string, { x: number; y: number }>,
  options: {
    duration: number
    stagger: number
  }
): Promise<void> {
  const entries = Array.from(nodeElements.entries())

  for (const [id, element] of entries) {
    const target = targetPositions.get(id)
    if (!target) continue

    await animateNodeToPosition(element, target.x, target.y, options.duration)
    await new Promise((resolve) => setTimeout(resolve, options.stagger))
  }
}

/**
 * 动画组管理
 */
export class AnimationGroup {
  private animations: Promise<void>[] = []
  private cancelled = false

  add(promise: Promise<void>): void {
    this.animations.push(promise)
  }

  async wait(): Promise<void> {
    if (this.cancelled) return
    await Promise.all(this.animations)
  }

  cancel(): void {
    this.cancelled = true
    this.animations = []
  }
}
