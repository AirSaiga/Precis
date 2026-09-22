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
 * @fileoverview 路径标准化工具测试（§3.1/§3.3 存储与比较分工 + source key 对齐后端）
 */

import { describe, it, expect } from 'vitest'
import {
  encodeConfigPathHeader,
  normalizePath,
  resolveRelativePath,
  toPosixPath,
} from '@/core/utils/pathNormalization'
import { normalizeSourceKey, sourceKeyString } from '@/utils/typeHelpers'

describe('normalizePath 的 POSIX 绝对路径前导斜杠（跨平台回归）', () => {
  // 回归背景：split('/') 把前导 '/' 拆成空段被过滤，'/tmp/x' 曾被相对化成
  // 'tmp/x'——Linux/macOS（含 CI E2E）上数据源绝对路径以相对形态发往后端 404
  it('POSIX 绝对路径保留前导斜杠', () => {
    expect(normalizePath('/tmp/precis-e2e-3417/data/vw_users.csv')).toBe(
      '/tmp/precis-e2e-3417/data/vw_users.csv'
    )
    expect(normalizePath('/home/user/proj/')).toBe('/home/user/proj')
  })

  it('POSIX 路径的 .. 段消解不越过根', () => {
    expect(normalizePath('/a/b/../c')).toBe('/a/c')
    expect(normalizePath('/a/../..')).toBe('/')
  })

  it('相对路径行为不变（无前导斜杠引入）', () => {
    expect(normalizePath('relative/dir/file.csv')).toBe('relative/dir/file.csv')
    expect(normalizePath('./a/b')).toBe('a/b')
  })

  it('resolveRelativePath 以 POSIX 项目根解析出 POSIX 绝对路径', () => {
    expect(resolveRelativePath('data/vw_users.csv', '/tmp/precis-e2e-3417')).toBe(
      '/tmp/precis-e2e-3417/data/vw_users.csv'
    )
  })

  it('resolveRelativePath 传输层语义：任何平台保留大小写（Linux 大小写敏感 FS 上小写化即 404）', () => {
    // CI 实证：mkdtemp 目录含大写（spXBBa），Playwright headless 在 Linux 上
    // UA 报 Windows —— 比较层规范化误转小写后发后端文件不存在
    expect(resolveRelativePath('data/VW_Users.csv', '/tmp/precis-e2e-4886-spXBBa')).toBe(
      '/tmp/precis-e2e-4886-spXBBa/data/VW_Users.csv'
    )
    // Windows 盘符路径同样保留大小写
    expect(resolveRelativePath('Data/Users.csv', 'D:/Proj-AbC')).toBe('D:/Proj-AbC/Data/Users.csv')
  })

  it('resolveRelativePath 绝对 rel 分支保留大小写并消解 ..', () => {
    expect(resolveRelativePath('/Tmp/A/../B.csv', '/x/Proj')).toBe('/Tmp/B.csv')
  })
})

describe('encodeConfigPathHeader（header 线上安全值契约）', () => {
  it('中文路径转义为纯 ASCII，且可无损还原', () => {
    const path = 'D:\\precis隔离测试\\测试数据\\precis-project'
    const encoded = encodeConfigPathHeader(path)
    // encodeURIComponent 契约：结果不含非 ASCII 字符（可安全通过 XHR ByteString 校验）
    expect(/[^\x00-\x7F]/.test(encoded)).toBe(false)
    expect(decodeURIComponent(encoded)).toBe(path)
  })

  it('ASCII 路径原样返回（不引入多余转义）', () => {
    expect(encodeConfigPathHeader('D:/plain/proj')).toBe('D:/plain/proj')
  })

  it('幂等：转义结果再次转义不变（重试重复经过出口不会二次编码）', () => {
    const path = 'D:\\隔离测试\\proj'
    const once = encodeConfigPathHeader(path)
    expect(encodeConfigPathHeader(once)).toBe(once)
  })
})

describe('toPosixPath（§3.1 存储层专用）', () => {
  it('保留原始大小写', () => {
    expect(toPosixPath('D:\\Data\\MyFile.CSV')).toBe('D:/Data/MyFile.CSV')
  })

  it('保留 .. 段（不消解——由目标平台解析）', () => {
    expect(toPosixPath('../shared/data.csv')).toBe('../shared/data.csv')
  })

  it('UNC 前缀双斜杠保留', () => {
    expect(toPosixPath('\\\\server\\share\\data.csv')).toBe('//server/share/data.csv')
    expect(toPosixPath('//server/share/data.csv')).toBe('//server/share/data.csv')
  })

  it('合并冗余斜杠与去尾斜杠', () => {
    expect(toPosixPath('D://double//slash/')).toBe('D:/double/slash')
  })

  it('空输入返回空串', () => {
    expect(toPosixPath('')).toBe('')
  })
})

describe('normalizePath（比较层）与 toPosixPath 分工', () => {
  // B33: Windows（大小写不敏感 FS）转小写、Linux/macOS 保留原大小写——测试按平台感知断言
  const isWin = typeof navigator !== 'undefined' && /Win/i.test(navigator.userAgent)

  it('同一文件不同分隔符写法经 normalizePath 判同 key（平台无关）', () => {
    expect(normalizePath('D:/Data/File.csv')).toBe(normalizePath('D:\\Data\\File.csv'))
  })

  it('跨大小写判同仅在 Windows 生效（B33：Linux/macOS 大小写敏感为正确行为）', () => {
    if (isWin) {
      expect(normalizePath('D:/Data/File.csv')).toBe(normalizePath('d:\\data\\FILE.CSV'))
    } else {
      expect(normalizePath('D:/Data/File.csv')).not.toBe(normalizePath('d:\\data\\FILE.CSV'))
    }
  })

  it('存储值经 toPosixPath 保留大小写后，同源输入仍可经 normalizePath 比较（平台无关）', () => {
    const stored = toPosixPath('D:\\Data\\File.csv')
    expect(stored).toBe('D:/Data/File.csv')
    expect(normalizePath(stored)).toBe(normalizePath('D:/Data/File.csv'))
  })
})

describe('normalizeSourceKey（§3.3 对齐后端 PurePosixPath）', () => {
  it('不消解 .. 段（后端 str(PurePosixPath) 保留）', () => {
    const [p] = normalizeSourceKey('../shared/data.csv', null)
    expect(p).toBe('../shared/data.csv')
  })

  it('滤 . 段与空段', () => {
    const [p] = normalizeSourceKey('./a//b/./c.csv', null)
    expect(p).toBe('a/b/c.csv')
  })

  it('与后端语义一致的归一小写', () => {
    const [p] = normalizeSourceKey('Data/Users.XLSX', 'Sheet1')
    expect(p).toBe('data/users.xlsx')
    expect(p).not.toContain('..')
  })

  it('sheet 大小写归一与空串统一 null', () => {
    expect(normalizeSourceKey('a.csv', 'SHEET1')[1]).toBe('sheet1')
    expect(normalizeSourceKey('a.csv', '')[1]).toBeNull()
    expect(normalizeSourceKey('a.csv', null)[1]).toBeNull()
  })

  it('不同 .. 形态判异（与后端一致——原消解逻辑会误判同）', () => {
    expect(sourceKeyString('../x/a.csv', null)).not.toBe(sourceKeyString('x/a.csv', null))
  })
})
