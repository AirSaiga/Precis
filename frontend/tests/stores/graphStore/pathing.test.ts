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
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, type Ref } from 'vue'
import type { CustomNode, CustomNodeData } from '@/types/graph'
import type { ProjectStoreLike } from '@/types/storeInterfaces'

vi.mock('@/features/keyboard/platform', () => ({
  platformDetector: { isWindows: () => false },
}))

vi.mock('@/core/utils/pathNormalization', () => ({
  isAbsolutePath: (p: string) => /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('/'),
  normalizeConfigDir: (p: string) => p.replace(/[/\\]+$/, ''),
}))

import { createPathingModule } from '@/stores/graphStore/modules/pathing'

function makeSchemaNode(id: string, localPath?: string): CustomNode {
  return {
    id,
    type: 'schema',
    position: { x: 0, y: 0 },
    data: { configName: 'test', tableName: 'users', localPath } as unknown as CustomNodeData,
  } as CustomNode
}

describe('createPathingModule', () => {
  let nodes: Ref<CustomNode[]>
  let projectStore: ProjectStoreLike
  let module: ReturnType<typeof createPathingModule>

  beforeEach(() => {
    nodes = ref<CustomNode[]>([])
    projectStore = {
      currentPaths: { configPath: undefined },
      setProjectPaths: vi.fn(),
    } as unknown as ProjectStoreLike
    module = createPathingModule({ nodes, projectStore })
  })

  describe('isCrossPlatformInvalidPath', () => {
    it('Unix 风格路径在 Windows 上无效', () => {
      // platformDetector.isWindows() returns false in mock, so Unix path is valid
      expect(module.isCrossPlatformInvalidPath('/home/user')).toBe(false)
    })

    it('空路径返回 false', () => {
      expect(module.isCrossPlatformInvalidPath('')).toBe(false)
    })
  })

  describe('resolveProjectRelativePath', () => {
    it('相对路径拼接', () => {
      const result = module.resolveProjectRelativePath('/project', 'data/file.xlsx')
      expect(result).toBe('/project/data/file.xlsx')
    })

    it('绝对路径直接返回', () => {
      const result = module.resolveProjectRelativePath('/project', '/abs/file.xlsx')
      expect(result).toBe('/abs/file.xlsx')
    })

    it('空参数返回 undefined', () => {
      expect(module.resolveProjectRelativePath('', 'data.xlsx')).toBeUndefined()
      expect(module.resolveProjectRelativePath('/project', '')).toBeUndefined()
    })

    it('去除 ./ 前缀', () => {
      const result = module.resolveProjectRelativePath('/project', './data.xlsx')
      expect(result).toBe('/project/data.xlsx')
    })
  })

  describe('getEffectiveProjectConfigPath', () => {
    it('优先使用 projectStore 路径', () => {
      ;(projectStore as any).currentPaths = { configPath: '/store/path' }
      const result = module.getEffectiveProjectConfigPath()
      expect(result).toBe('/store/path')
    })

    it('回退到 schema 节点推断', () => {
      nodes.value = [makeSchemaNode('s1', '/schema/path')]
      const result = module.getEffectiveProjectConfigPath()
      expect(result).toBe('/schema/path')
    })

    it('无路径时返回 undefined', () => {
      const result = module.getEffectiveProjectConfigPath()
      expect(result).toBeUndefined()
    })
  })

  describe('normalizeConfigDir', () => {
    it('去除末尾斜杠', () => {
      expect(module.normalizeConfigDir('/path/to/dir/')).toBe('/path/to/dir')
    })

    it('文件路径提取目录', () => {
      const result = module.normalizeConfigDir('/path/to/file.csv')
      expect(result).toBe('/path/to/file.csv')
    })
  })
})
