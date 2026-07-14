/**
 * @fileoverview paths 工具函数单元测试
 *
 * 验证开发与生产环境下后端/前端资源路径解析是否正确。
 *
 * 注意：getBackendPath/getFrontendPath 内部使用 node 的 path.join，
 * 在 Windows 上产出反斜杠分隔符，在 POSIX 上产出正斜杠分隔符。
 * 因此断言需与平台一致，避免在不同平台失败。
 */

import { describe, it, expect } from 'vitest'
import * as path from 'path'
import { getBackendPath, getFrontendPath, getPreloadPath, getSplashPreloadPath, getSplashHtmlPath } from '../src/utils/paths'

describe('paths', () => {
  // 输入路径用平台原生分隔符，避免 path.join 跨平台混用分隔符
  const devDirname = path.join('/project', 'electron', 'dist')
  const resourcesPath = path.join('/app', 'resources')

  describe('getBackendPath', () => {
    it('开发环境：基于 __dirname 返回 ../backend', () => {
      const result = getBackendPath(false, resourcesPath, devDirname)
      expect(result).toBe(path.join('/project', 'electron', 'backend'))
    })

    it('生产环境：基于 resourcesPath 返回 resources/backend', () => {
      const result = getBackendPath(true, resourcesPath, devDirname)
      expect(result).toBe(path.join('/app', 'resources', 'backend'))
    })
  })

  describe('getFrontendPath', () => {
    it('开发环境：基于 __dirname 返回 ../frontend/dist', () => {
      const result = getFrontendPath(false, resourcesPath, devDirname)
      expect(result).toBe(path.join('/project', 'electron', 'frontend', 'dist'))
    })

    it('生产环境：基于 resourcesPath 返回 resources/frontend/dist', () => {
      const result = getFrontendPath(true, resourcesPath, devDirname)
      expect(result).toBe(path.join('/app', 'resources', 'frontend', 'dist'))
    })
  })

  // preload/splash 路径：callerDirname 预期为 dist/windows/（编译后位置）
  const windowsDirname = path.join('/project', 'electron', 'dist', 'windows')

  describe('getPreloadPath', () => {
    it('从 dist/windows/ 上溯一级到 dist/preload.js', () => {
      expect(getPreloadPath(windowsDirname)).toBe(path.join('/project', 'electron', 'dist', 'preload.js'))
    })
  })

  describe('getSplashPreloadPath', () => {
    it('从 dist/windows/ 上溯一级到 dist/splash-preload.js', () => {
      expect(getSplashPreloadPath(windowsDirname)).toBe(
        path.join('/project', 'electron', 'dist', 'splash-preload.js')
      )
    })
  })

  describe('getSplashHtmlPath', () => {
    it('从 dist/windows/ 上溯两级到 electron/assets/splash.html', () => {
      expect(getSplashHtmlPath(windowsDirname)).toBe(
        path.join('/project', 'electron', 'assets', 'splash.html')
      )
    })
  })
})
