import { describe, it, expect } from 'vitest'
import {
  getEdgeStrokeClass,
  getParticleColorClass,
  shouldRenderParticles,
} from '@/utils/edgeParticleColor'

describe('edgeParticleColor', () => {
  it('idle 态不渲染粒子', () => {
    expect(shouldRenderParticles('idle')).toBe(false)
    expect(shouldRenderParticles(undefined)).toBe(false)
  })
  it('pass/error/missing 态渲染粒子', () => {
    expect(shouldRenderParticles('pass')).toBe(true)
    expect(shouldRenderParticles('error')).toBe(true)
    expect(shouldRenderParticles('missing')).toBe(true)
  })
  it('颜色 class 映射正确', () => {
    expect(getParticleColorClass('pass')).toBe('particle--pass')
    expect(getParticleColorClass('error')).toBe('particle--error')
    expect(getParticleColorClass('missing')).toBe('particle--missing')
    expect(getParticleColorClass('idle')).toBe('')
    expect(getParticleColorClass(undefined)).toBe('')
  })
})

describe('getEdgeStrokeClass（边主线校验着色）', () => {
  it('校验完成态映射到对应着色 class', () => {
    expect(getEdgeStrokeClass('pass')).toBe('edge-stroke--pass')
    expect(getEdgeStrokeClass('error')).toBe('edge-stroke--error')
    expect(getEdgeStrokeClass('missing')).toBe('edge-stroke--missing')
  })
  it('未运行（idle/undefined）不着色，维持中性线', () => {
    expect(getEdgeStrokeClass('idle')).toBe('')
    expect(getEdgeStrokeClass(undefined)).toBe('')
  })
})
