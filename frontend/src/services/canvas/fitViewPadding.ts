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
 * @fileoverview fitView 安全留白常量（中立位置，供 store/服务层与布局 feature 共用）
 */

/**
 * 自动取景的安全留白（整理/加载适配/快捷键取景共用）。
 * 不对称 px 留白：右下角 MiniMap 悬浮在画布内、右侧检查器面板展开会使画布
 * 收窄、底部状态栏覆盖画布下缘——取景时让出这些区域，否则取景后节点贴边
 * 落在浮层之下点不到（按钮类元素被状态栏拦截 hit-test）。
 *
 * SAFE_FITVIEW_PADDING_PX 是数值单一事实源（布局算法估算可用区域时用），
 * SAFE_FITVIEW_PADDING 是传给 fitView 的 CSS px 形式，两者必须同步。
 *
 * 位置说明：常量从 features/node-layout-organizer/constants.ts 上移至此，
 * 因为 canvasStore 等非 feature 层也需要它——store → feature 是反向依赖，
 * 服务层（services/canvas）是双方都能依赖的中立位置。feature 侧 constants.ts
 * re-export 保持既有导入路径不变。
 */
export const SAFE_FITVIEW_PADDING_PX = {
  top: 60,
  left: 60,
  right: 360,
  bottom: 200,
} as const

export const SAFE_FITVIEW_PADDING = {
  top: `${SAFE_FITVIEW_PADDING_PX.top}px`,
  left: `${SAFE_FITVIEW_PADDING_PX.left}px`,
  right: `${SAFE_FITVIEW_PADDING_PX.right}px`,
  bottom: `${SAFE_FITVIEW_PADDING_PX.bottom}px`,
} as const
