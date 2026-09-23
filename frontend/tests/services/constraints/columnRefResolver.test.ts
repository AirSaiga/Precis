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
 * @file columnRefResolver.test.ts
 * @description 约束列引用解析器单元测试
 *
 * 验证严格的两类引用语义：
 * - resolve()（名称字段）：仅顶层裸名 / 嵌套「父.子」全限定路径，无任何兜底
 * - byId()（ID 字段）：按列 ID 直查任意层级列
 * 与后端 embedded_constraints（build_qualified_name_to_id_map）保持一致。
 */

import { describe, it, expect } from 'vitest'
import {
  buildColumnRefResolver,
  type ColumnRefNode,
} from '@/services/constraints/columnRefResolver'

const makeTree = (): ColumnRefNode[] => [
  { id: 'col-email', columnName: 'email' },
  {
    id: 'col-customer',
    columnName: 'customer',
    children: [
      { id: 'col-customer-email', columnName: 'email' },
      {
        id: 'col-address',
        columnName: 'address',
        children: [{ id: 'col-address-city', columnName: 'city' }],
      },
    ],
  },
  // V2 ColumnSpecV2 形状（name 字段而非 columnName）
  { id: 'col-uid', name: 'user_id' },
]

describe('buildColumnRefResolver.resolve（名称字段，严格）', () => {
  it('顶层列按裸名精确解析', () => {
    const { resolve } = buildColumnRefResolver(makeTree())
    expect(resolve('email')).toEqual({
      columnId: 'col-email',
      columnName: 'email',
      rootColumnId: 'col-email',
    })
  })

  it('嵌套子列按「父.子」全限定路径解析，rootColumnId 指向顶层祖先', () => {
    const { resolve } = buildColumnRefResolver(makeTree())
    expect(resolve('customer.email')).toEqual({
      columnId: 'col-customer-email',
      columnName: 'customer.email',
      rootColumnId: 'col-customer',
    })
  })

  it('深层嵌套用完整点分路径解析', () => {
    const { resolve } = buildColumnRefResolver(makeTree())
    expect(resolve('customer.address.city')).toEqual({
      columnId: 'col-address-city',
      columnName: 'customer.address.city',
      rootColumnId: 'col-customer',
    })
  })

  it('顶层与嵌套同名时裸名精确绑定顶层列', () => {
    const { resolve } = buildColumnRefResolver(makeTree())
    expect(resolve('email')?.columnId).toBe('col-email')
  })

  it('嵌套子列裸名不做递归猜测：无顶层同名列则未命中', () => {
    const { resolve } = buildColumnRefResolver(makeTree())
    expect(resolve('city')).toBeUndefined()
  })

  it('列 ID 传入名称解析器不被接受（严格模式，无兜底）', () => {
    const { resolve } = buildColumnRefResolver(makeTree())
    expect(resolve('col-customer-email')).toBeUndefined()
    expect(resolve('col-email')).toBeUndefined()
  })

  it('兼容 V2 ColumnSpecV2 的 name 字段', () => {
    const { resolve } = buildColumnRefResolver(makeTree())
    expect(resolve('user_id')?.columnId).toBe('col-uid')
  })

  it('未命中 / 空串返回 undefined', () => {
    const { resolve } = buildColumnRefResolver(makeTree())
    expect(resolve('nope')).toBeUndefined()
    expect(resolve('')).toBeUndefined()
  })

  it('空树 / undefined 树返回 undefined', () => {
    expect(buildColumnRefResolver([]).resolve('email')).toBeUndefined()
    expect(buildColumnRefResolver(undefined).resolve('email')).toBeUndefined()
  })

  it('同名键保留深度优先首个', () => {
    const tree: ColumnRefNode[] = [
      { id: 'a', columnName: 'a', children: [{ id: 'a-name', columnName: 'name' }] },
      { id: 'b', columnName: 'b', children: [{ id: 'b-name', columnName: 'name' }] },
    ]
    const { resolve } = buildColumnRefResolver(tree)
    expect(resolve('a.name')?.columnId).toBe('a-name')
    expect(resolve('b.name')?.columnId).toBe('b-name')
    const dup: ColumnRefNode[] = [
      { id: 'x1', columnName: 'dup' },
      { id: 'x2', columnName: 'dup' },
    ]
    expect(buildColumnRefResolver(dup).resolve('dup')?.columnId).toBe('x1')
  })
})

describe('buildColumnRefResolver.byId（ID 字段直查）', () => {
  it('按列 ID 直查顶层列', () => {
    const { byId } = buildColumnRefResolver(makeTree())
    expect(byId('col-email')?.columnName).toBe('email')
  })

  it('按列 ID 直查嵌套子列（含全限定名与顶层祖先）', () => {
    const { byId } = buildColumnRefResolver(makeTree())
    expect(byId('col-customer-email')).toEqual({
      columnId: 'col-customer-email',
      columnName: 'customer.email',
      rootColumnId: 'col-customer',
    })
  })

  it('未命中返回 undefined', () => {
    const { byId } = buildColumnRefResolver(makeTree())
    expect(byId('col-nope')).toBeUndefined()
  })
})
