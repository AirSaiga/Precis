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
 * @fileoverview 节点组件"位置 prop 隔离壳"（M1 组件重渲隔离）
 *
 * 背景：Vue Flow 的 NodeWrapper 每次渲染都把 `position: node.computedPosition`
 * （拖拽/整理落位期间每 tick 一个新对象）和新建容器的 `events` 对象传给节点组件。
 * 业务节点组件即使不声明这些 prop，fallthrough attrs 引用变化也会强制整棵
 * 子树重渲（SchemaNode 等重组件含列行 v-for + 每列 Handle）——这是大画布
 * 节点拖拽掉帧与整理落位 flush 的主要渲染开销（2026-09-06 流畅度测量）。
 *
 * 本壳拦截 position 并对其余 attrs 做逐 key 值稳定化（events 容器做一层浅
 * 比较）：当且仅当业务数据（data/selected/dragging 等）真实变化时才让内层
 * 组件重渲。壳自身每 tick 只做一次 attrs 比较（微秒级）。
 *
 * 不影响 inject 链（NodeId 等 provide/inject 穿透中间组件）、emits（events
 * 经 props 转发）与 Handle 尺寸上报（onUpdateNodeInternals 在 attrs 中转发）。
 */

import { defineComponent, h } from 'vue'
import type { Component } from 'vue'

/** 是否为普通对象（排除 null 与数组） */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 从 NodeWrapper 传入的 attrs 中剥离 position。
 * 视觉位移由 NodeWrapper 自身的 wrapper div（transform）承担，内层内容组件
 * 从不需要节点坐标（全仓节点组件 props 均只声明 id/data/selected）。
 */
export function stripVolatileAttrs(attrs: Record<string, unknown>): Record<string, unknown> {
  const rest = { ...attrs }
  delete rest.position
  return rest
}

/**
 * 逐 key 稳定化：值与上一帧全等（===）时沿用上一帧引用，使内层组件 vnode
 * 的 props 逐 key 全等，Vue 即可跳过子组件更新。
 *
 * 特例：`events` 是 NodeWrapper 每次渲染新建的容器对象（{...node.events, ...on}），
 * 其 handler 值本身引用稳定——一层浅比较全等则沿用旧容器，否则整体换新。
 * 其余键数变化或任一值变化时按新值输出（新值传播语义不变）。
 */
export function stabilizeNodeProps(
  prev: Record<string, unknown> | null,
  next: Record<string, unknown>
): Record<string, unknown> {
  if (!prev) return next
  const keys = Object.keys(next)
  if (keys.length !== Object.keys(prev).length) return next
  const out: Record<string, unknown> = {}
  for (const key of keys) {
    const nv = next[key]
    const pv = prev[key]
    if (Object.is(nv, pv)) {
      out[key] = pv
      continue
    }
    if (key === 'events' && isPlainObject(nv) && isPlainObject(pv)) {
      const eventKeys = Object.keys(nv)
      if (
        eventKeys.length === Object.keys(pv).length &&
        eventKeys.every((k) => Object.is(nv[k], pv[k]))
      ) {
        out[key] = pv
        continue
      }
    }
    out[key] = nv
  }
  return out
}

/**
 * 把业务节点组件包进位置隔离壳。经 useNodeTypeRegistry 统一接线，
 * 内层组件保持原样（props/emits/inject 全部不变）。
 */
export function withNodePositionIsolation(inner: unknown, name: string): Component {
  // inner 收 object：Vue Flow 的 NodeComponent 联合含 string 成员，注册表侧无法以
  // Component 精确收窄；运行时永远是组件对象（与 rawNode 集中断言同模式），仅此处
  // 一次 object→Component 断言。
  const innerComponent = inner as Component
  return defineComponent({
    name,
    inheritAttrs: false,
    setup(_, { attrs }) {
      let prev: Record<string, unknown> | null = null
      return () => {
        const next = stripVolatileAttrs({ ...attrs })
        const stable = stabilizeNodeProps(prev, next)
        prev = stable
        return h(innerComponent, stable)
      }
    },
  })
}
