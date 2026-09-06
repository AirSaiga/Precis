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
  NODE_ENTER_DURATION_MS,
  EDGE_DRAW_DURATION_MS,
  FITVIEW_DURATION_MS,
  NODE_ENTERING_CLASS,
  EDGE_DRAWING_CLASS,
} from '@/services/canvas/animationDurations'

/**
 * 这些常量与设计令牌（tokens/primitive.css 的 --dur-*）保持同源。
 * 此测试锁定关键数值，防止与 CSS 令牌无意中漂移。
 */
describe('animationDurations 常量', () => {
  it('节点入场时长对应 CSS --dur-enter (300ms)', () => {
    expect(NODE_ENTER_DURATION_MS).toBe(300)
  })

  it('边绘制时长对应 CSS --dur-edge-draw (200ms)', () => {
    expect(EDGE_DRAW_DURATION_MS).toBe(200)
  })

  it('fitView 时长对应 CSS --dur-fitview (400ms)', () => {
    expect(FITVIEW_DURATION_MS).toBe(400)
  })

  it('class 名与 CSS 选择器一致', () => {
    expect(NODE_ENTERING_CLASS).toBe('node-entering')
    expect(EDGE_DRAWING_CLASS).toBe('edge-drawing')
  })
})
