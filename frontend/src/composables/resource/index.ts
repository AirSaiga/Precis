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
 * @description 资源相关 composables barrel 导出
 */

/** 资源树组合式函数 */
export * from './useResourceTree'

/** 统一拖拽处理组合式函数 */
export * from './useResourceDrag'

/** 右键菜单组合式函数 */
export * from './useResourceContextMenu'

/** 约束类型元数据与分类 */
export * from './useConstraintTypes'

/** 工具箱节点创建逻辑 */
export * from './useToolboxCreators'

/** 资源交互事件（长按、多选） */
export * from './useResourceInteraction'
