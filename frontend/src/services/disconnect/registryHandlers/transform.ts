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
 * Transform 转换节点断开连接处理器
 *
 * 处理上游 → transform 断开的清理：
 * - 重置 inputFromNode / inputColumn
 * - 标记为 draft
 */
import { registerDisconnectHandler } from '../registryCore'

registerDisconnectHandler({
  priority: 70,
  match: (_edge, _source, target) => target.type === 'transform',
  cleanup: (edge, source, target, ctx) => {
    ctx.updateNodeData(target.id, {
      inputFromNode: undefined,
      inputColumn: undefined,
      saveState: 'draft',
    })
  },
})
