/**
 * @file edgeParticleColor.ts
 * @description 边粒子校验状态 → 颜色 class 映射（纯函数）
 *
 * 值域对齐 types/constraints.ts 的 validationStatus: 'idle'|'pass'|'error'|'missing'
 * 颜色语义复用节点 status-dot：pass=绿 / error=红 / missing=橙
 */

export type EdgeValidationStatus = 'idle' | 'pass' | 'error' | 'missing' | undefined

/** idle 或无值时不渲染粒子（边保持静态线） */
export function shouldRenderParticles(status: EdgeValidationStatus): boolean {
  return status !== 'idle' && status !== undefined
}

/** 状态 → CSS class（驱动 fill/filter 着色，与 animation 解耦以支持 reduced-motion） */
export function getParticleColorClass(status: EdgeValidationStatus): string {
  switch (status) {
    case 'pass':
      return 'particle--pass'
    case 'error':
      return 'particle--error'
    case 'missing':
      return 'particle--missing'
    default:
      return ''
  }
}
