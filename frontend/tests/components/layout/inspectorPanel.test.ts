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
 * @fileoverview InspectorPanel 单元测试
 *
 * 重点回归（E4）：Inspector 编辑（update:data 事件）在透传给 graphStore 前必须补
 * saveState: 'draft'，否则未保存更改绕过关闭确认（useSchemaSaving）与
 * 项目重载守卫（useProjectReload）两道按 saveState==='draft' 过滤的闸门。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import InspectorPanel from '@/components/layout/InspectorPanel.vue'

const mocks = vi.hoisted(() => ({
  updateNodeData: vi.fn(),
  updateResourceName: vi.fn(),
  baseInspectorEmit: undefined as undefined | ((event: 'update:data', data: unknown) => void),
  selectedNode: undefined as unknown,
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
  createI18n: () => ({ global: { t: (key: string) => key } }),
}))

vi.mock('@/stores/graphStore', () => ({
  useGraphStore: () => ({
    get selectedNode() {
      return mocks.selectedNode
    },
    nodes: [],
    edges: [],
    updateNodeData: mocks.updateNodeData,
  }),
}))

vi.mock('@/stores/resourceTreeStore', () => ({
  useResourceTreeStore: () => ({ updateResourceName: mocks.updateResourceName }),
}))

// 弹窗与配置驱动 Inspector 换成空壳，避免拉起 VueFlow / 渲染器注册表等重依赖
vi.mock('@/components/canvas/SubCanvasModal.vue', () => ({
  default: { name: 'SubCanvasModal', setup: () => () => null },
}))

vi.mock('@/components/layout/inspectors/configDriven/BaseInspector.vue', () => ({
  default: {
    name: 'BaseInspector',
    emits: ['update:data'],
    setup(_props: unknown, { emit }: { emit: (event: string, data: unknown) => void }) {
      mocks.baseInspectorEmit = (event, data) => emit(event, data)
      return () => null
    },
  },
}))

function makeSelectedNode(type: string, data: Record<string, unknown>) {
  return { id: 'node-1', type, position: { x: 0, y: 0 }, data }
}

describe('InspectorPanel handleDataUpdate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // regex 节点走配置驱动 Inspector（getInspectorConfig('regex') 有配置）→ BaseInspector 路径
    mocks.selectedNode = makeSelectedNode('regex', { configName: 'emailRegex', saveState: 'saved' })
  })

  it('update:data 透传时补 saveState: draft（关闭确认/重载守卫可见）', async () => {
    const wrapper = mount(InspectorPanel)

    mocks.baseInspectorEmit!('update:data', { configName: 'emailRegex_v2' })
    await wrapper.vm.$nextTick()

    expect(mocks.updateNodeData).toHaveBeenCalledWith(
      'node-1',
      expect.objectContaining({ configName: 'emailRegex_v2', saveState: 'draft' })
    )
    wrapper.unmount()
  })

  it('update:data 不覆盖 patch 中已有的 saveState 语义：统一置 draft', async () => {
    const wrapper = mount(InspectorPanel)

    mocks.baseInspectorEmit!('update:data', { configName: 'emailRegex_v3', saveState: 'saved' })
    await wrapper.vm.$nextTick()

    expect(mocks.updateNodeData).toHaveBeenCalledWith(
      'node-1',
      expect.objectContaining({ saveState: 'draft' })
    )
    wrapper.unmount()
  })
})
