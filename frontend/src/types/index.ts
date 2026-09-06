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
 * @file index.ts
 * @description 类型定义统一导出文件
 */

// 通用类型
export * from './common'

// API类型
export * from './api'

// 节点类型
export * from './nodes'

// 约束类型
export * from './constraints'

// 正则类型
export * from '@/features/regex/types'

// 数据源类型
export * from './datasource'

// 拖拽类型
export * from './drag'

// 图形类型（保留向后兼容）
export * from './graph'

// 设置类型
export * from './settings'
