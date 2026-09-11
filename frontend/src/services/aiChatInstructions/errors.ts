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
 * @fileoverview AI 指令链路共享错误类型（独立成模块避免 handler ↔ 连接工具循环导入）。
 */

import type { FrontendInstruction } from '@/stores/aiChatStore'

/**
 * AI 指令执行过程中遇到无法继续的非法连接时抛出的错误
 */
export class AIInstructionError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly instruction?: FrontendInstruction
  ) {
    super(message)
    this.name = 'AIInstructionError'
  }
}
