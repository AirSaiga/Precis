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
 * 节点布局整理器 - 模块入口
 *
 * 功能：
 * 1. 提供节点自动整理收纳功能
 * 2. 以 Schema 为核心的布局策略
 * 3. 支持平滑动画过渡
 * 4. 可手动触发或自动监听触发
 *
 * 使用方式：
 * import { useNodeOrganizer } from '@/features/node-layout-organizer';
 * const { quickOrganize } = useNodeOrganizer();
 */

// 类型导出
export * from './types'

// 常量导出
export * from './constants'

// Vue 组合式函数导出
export { useNodeOrganizer } from './composables/useNodeOrganizer'
export { useAutoOrganize } from './composables/useAutoOrganize'
