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
 * @description Regex 功能模块统一导出入口
 */

// 导出所有组件
export { default as RegexDesignModal } from './components/RegexDesignModal.vue'
export { default as RegexNode } from './components/RegexNode.vue'
export { default as RuleConfigPanel } from './components/RuleConfigPanel.vue'
export { default as RuleList } from './components/RuleList.vue'
export { default as InteractiveBuilder } from './components/InteractiveBuilder.vue'

// 导出所有组合式函数
export * from './composables'

// 导出所有类型
export * from './types'

// 导出所有服务
export * from './services/regexBuilder'
export * from './services/regexExtractService'
export * from './services/regexOutputMapping'
