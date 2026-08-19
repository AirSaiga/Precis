/**
 * @file edgeParticleColor.ts
 * @description 边校验状态 → 颜色 class 映射（纯函数）
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

/**
 * 状态 → 边主线 stroke 着色 class（纯函数）
 *
 * 语义：校验完成后边线本体按结论着色，未运行（idle/undefined）保持中性虚线。
 * pass → success 色、error → danger 色、missing → warning 色（引用语义 token，
 * dark/liquid 主题自适应）。class 由 DeletableEdge 挂在外层 <g>，
 * 经 :deep(.vue-flow__edge-path) 作用于边 path。
 */
export function getEdgeStrokeClass(status: EdgeValidationStatus): string {
  switch (status) {
    case 'pass':
      return 'edge-stroke--pass'
    case 'error':
      return 'edge-stroke--error'
    case 'missing':
      return 'edge-stroke--missing'
    default:
      return ''
  }
}
