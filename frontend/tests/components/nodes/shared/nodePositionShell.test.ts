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
/**
 * @file nodePositionShell.test.ts
 * @description 位置隔离壳测试：纯函数（stripVolatileAttrs / stabilizeNodeProps）
 * + 挂载级行为（position churn 不触发内层重渲、真实变化触发）。
 * 挂载级测试守护 Vue 运行时语义（attrs track/trigger + props 浅比较跳过），
 * Vue 升级若破坏该机制则在此报警。
 */
import { describe, expect, it } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { mount } from '@vue/test-utils'
import {
  stabilizeNodeProps,
  stripVolatileAttrs,
  withNodePositionIsolation,
} from '@/components/nodes/shared/nodePositionShell'

const noop = () => {}

describe('stripVolatileAttrs', () => {
  it('剥离 position，保留其余 attrs', () => {
    const attrs = { id: 'n1', position: { x: 1, y: 2 }, selected: true }
    expect(stripVolatileAttrs(attrs)).toEqual({ id: 'n1', selected: true })
  })

  it('不修改原对象', () => {
    const attrs = { id: 'n1', position: { x: 1, y: 2 } }
    stripVolatileAttrs(attrs)
    expect(attrs.position).toEqual({ x: 1, y: 2 })
  })

  it('无 position 时原样复制', () => {
    expect(stripVolatileAttrs({ id: 'n1' })).toEqual({ id: 'n1' })
  })
})

describe('stabilizeNodeProps', () => {
  it('首帧（prev 为 null）原样返回 next', () => {
    const next = { id: 'n1', data: { a: 1 } }
    expect(stabilizeNodeProps(null, next)).toBe(next)
  })

  it('值全等（同一引用）的键沿用上一帧引用', () => {
    const data = { a: 1 }
    const prev = { id: 'n1', data }
    const next = { id: 'n1', data }
    const out = stabilizeNodeProps(prev, next)
    expect(out.data).toBe(data)
  })

  it('引用变化的键传播新值（浅比较语义：data 引用变化即视为真实变化）', () => {
    const prev = { id: 'n1', data: { a: 1 } }
    const next = { id: 'n1', data: { a: 1 } }
    const out = stabilizeNodeProps(prev, next)
    expect(out.data).toBe(next.data)
  })

  it('变化的键传播新值', () => {
    const prev = { id: 'n1', selected: false }
    const next = { id: 'n1', selected: true }
    expect(stabilizeNodeProps(prev, next)).toEqual({ id: 'n1', selected: true })
  })

  it('events 新容器但 handler 全等时沿用旧容器（NodeWrapper 每帧新建容器的稳定化）', () => {
    const events = { select: noop, move: noop }
    const prev = { id: 'n1', events }
    const next = { id: 'n1', events: { select: noop, move: noop } }
    const out = stabilizeNodeProps(prev, next)
    expect(out.events).toBe(events)
  })

  it('events handler 变化时换新容器', () => {
    const prev = { id: 'n1', events: { select: noop } }
    const next = { id: 'n1', events: { select: () => {} } }
    const out = stabilizeNodeProps(prev, next)
    expect(out.events).toBe(next.events)
  })

  it('键数变化时原样返回 next（防御分支）', () => {
    const prev = { id: 'n1', extra: 1 }
    const next = { id: 'n1' }
    expect(stabilizeNodeProps(prev, next)).toBe(next)
  })

  it('NaN 视为全等（Object.is 语义）', () => {
    const prev = { zIndex: NaN }
    const out = stabilizeNodeProps(prev, { zIndex: NaN })
    expect(Object.is(out.zIndex, NaN)).toBe(true)
  })
})

describe('withNodePositionIsolation 挂载行为', () => {
  /** 内层组件：记录渲染次数，声明业务组件同款 props（id/data/selected） */
  function makeInner(renderCount: { n: number }) {
    return defineComponent({
      name: 'InnerNode',
      props: { id: { type: String, required: true }, selected: { type: Boolean, default: false } },
      setup() {
        return () => {
          renderCount.n++
          return h('div', 'inner')
        }
      },
    })
  }

  it('position 每 tick 换新对象不触发内层重渲，selected 变化触发', async () => {
    const renderCount = { n: 0 }
    const position = ref({ x: 0, y: 0 })
    const selected = ref(false)
    const Shell = withNodePositionIsolation(makeInner(renderCount), 'TestShell')
    // 模拟 NodeWrapper：position/selected 作为 attrs（未在壳中声明）传入
    const Harness = defineComponent({
      setup() {
        return () =>
          h(Shell, { id: 'n1', position: position.value, selected: selected.value, events: {} })
      },
    })
    const wrapper = mount(Harness)
    expect(renderCount.n).toBe(1)

    // position churn ×5（模拟拖拽帧）
    for (let i = 1; i <= 5; i++) {
      position.value = { x: i, y: i }
      await wrapper.vm.$nextTick()
    }
    expect(renderCount.n).toBe(1)

    // 真实变化：selected 翻转 → 内层必须重渲
    selected.value = true
    await wrapper.vm.$nextTick()
    expect(renderCount.n).toBe(2)
    wrapper.unmount()
  })

  it('壳渲染输出内层组件（inheritAttrs:false 下 attrs 经显式转发）', () => {
    const renderCount = { n: 0 }
    const Shell = withNodePositionIsolation(makeInner(renderCount), 'TestShell2')
    const wrapper = mount(Shell, { attrs: { id: 'n2' } })
    expect(wrapper.text()).toBe('inner')
    expect(renderCount.n).toBe(1)
    wrapper.unmount()
  })
})
