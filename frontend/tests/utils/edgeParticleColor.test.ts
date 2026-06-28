import { describe, it, expect } from 'vitest'
import { getParticleColorClass, shouldRenderParticles } from '@/utils/edgeParticleColor'

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
