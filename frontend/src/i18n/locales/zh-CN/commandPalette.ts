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
 * @fileoverview 命令面板国际化 - 中文
 *
 * commands.* 的 key 由 paletteCommandRegistry 的 labelKey 动态引用
 * （t(`commandPalette.commands.${id}`)，前缀已登记 audit allowlist）。
 */

const commandPalette = {
  placeholder: '搜索节点或命令…',
  groups: {
    nodes: '节点',
    commands: '命令',
  },
  empty: '未找到匹配项',
  hiddenHint: '已隐藏',
  commands: {
    organize: '整理节点',
    save: '保存项目',
    validateAll: '全量校验',
    focusProjectRoot: '聚焦项目根',
    viewPanorama: '切换视图：全景',
    viewFocus: '切换视图：聚焦',
    viewErrorsOnly: '切换视图：仅异常',
  },
  footer: {
    navigate: '导航',
    confirm: '确认',
    dismiss: '关闭',
  },
}

export default commandPalette
