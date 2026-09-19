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
import { normalizePath, toPosixPath } from '@/core/utils/pathNormalization'
import { normalizeSourceKey, sourceKeyString } from '@/utils/typeHelpers'

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
  it('同一文件不同大小写写法经 normalizePath 判同 key', () => {
    expect(normalizePath('D:/Data/File.csv')).toBe(normalizePath('d:\\data\\FILE.CSV'))
  })

  it('存储值经 toPosixPath 保留大小写后仍可经 normalizePath 比较', () => {
    const stored = toPosixPath('D:\\Data\\File.csv')
    const incoming = 'd:/data/file.csv'
    expect(normalizePath(stored)).toBe(normalizePath(incoming))
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
