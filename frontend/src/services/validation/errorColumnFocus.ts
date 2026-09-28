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
 * @fileoverview 校验错误列级定位的一次性信箱（navigator 写入请求、检查器挂载时消费）
 *
 * InspectorPanel 以节点 id 为 key 重挂载检查器且检查器为异步组件，
 * navigator 发出的 inspector-focus-column 事件可能在检查器挂载前到达而丢失。
 * 此模块提供模块级 pending ref：navigator 写入请求，检查器在 onMounted 时
 * 消费（nodeId 匹配则执行滚动高亮），无论匹配与否都清空——信箱只服务
 * "下一次挂载"，避免残留请求在后续无关节点挂载时误触发。
 */
import { ref } from 'vue'

export interface ErrorColumnFocusRequest {
  nodeId: string
  /** 列机器 ID（SchemaColumn.id），优先匹配 */
  columnId?: string
  /** 列显示名（SchemaColumn.columnName），columnId 缺失时兜底 */
  columnName?: string
}

export const pendingErrorColumnFocus = ref<ErrorColumnFocusRequest | null>(null)
