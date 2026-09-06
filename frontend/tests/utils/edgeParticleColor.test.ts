/*
 * SPDX-License-Identifier: Apache-2.0
 *
 * Copyright 2026 Precis Team
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
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
