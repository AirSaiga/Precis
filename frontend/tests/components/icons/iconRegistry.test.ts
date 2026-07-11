/**
 * @fileoverview iconRegistry 纯映射单元测试
 *
 * 验证 ICON_REGISTRY 关键映射、约束/转换分类图标名一致性、getIcon 查询行为。
 * 纯模块，无 Vue/Pinia 依赖，符合 vitest 测试范围。
 */

import { describe, it, expect } from 'vitest'
import {
  ICON_REGISTRY,
  getIcon,
  CONSTRAINT_ICON_NAMES,
  TRANSFORM_CATEGORY_ICON_NAMES,
  TRANSFORM_TYPE_ICON_NAMES,
} from '@/components/icons/iconRegistry'

describe('iconRegistry', () => {
  it('getIcon 返回已注册图标组件', () => {
    expect(getIcon('check')).toBeDefined()
  })

  it('getIcon 对未知图标返回 undefined', () => {
    expect(getIcon('nonexistent')).toBeUndefined()
  })

  it('通用状态图标已注册', () => {
    const keys = ['check', 'x', 'alert', 'info', 'check-circle', 'trash', 'save', 'folder']
    for (const key of keys) {
      expect(ICON_REGISTRY[key]).toBeDefined()
    }
  })

  it('CONSTRAINT_ICON_NAMES 映射到已注册的图标名（10 个约束类型）', () => {
    const kinds = Object.keys(CONSTRAINT_ICON_NAMES)
    expect(kinds).toHaveLength(10)
    for (const kind of kinds) {
      const iconName = CONSTRAINT_ICON_NAMES[kind]
      expect(ICON_REGISTRY[iconName]).toBeDefined()
    }
  })

  it('TRANSFORM_CATEGORY_ICON_NAMES 映射到已注册的图标名（5 个分类）', () => {
    const categories = Object.keys(TRANSFORM_CATEGORY_ICON_NAMES)
    expect(categories).toHaveLength(5)
    for (const category of categories) {
      const iconName = TRANSFORM_CATEGORY_ICON_NAMES[category]
      expect(ICON_REGISTRY[iconName]).toBeDefined()
    }
  })

  it('TRANSFORM_TYPE_ICON_NAMES 映射到已注册的图标名（22 个转换类型）', () => {
    const types = Object.keys(TRANSFORM_TYPE_ICON_NAMES)
    expect(types).toHaveLength(22)
    for (const type of types) {
      const iconName = TRANSFORM_TYPE_ICON_NAMES[type]
      expect(ICON_REGISTRY[iconName]).toBeDefined()
    }
  })

  it('阶段实施所需的边界图标已注册', () => {
    const keys = ['lock', 'package', 'star', 'inbox', 'tag', 'image', 'presentation']
    for (const key of keys) {
      expect(ICON_REGISTRY[key]).toBeDefined()
    }
  })
})
