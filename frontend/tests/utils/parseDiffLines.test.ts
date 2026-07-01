import { describe, it, expect } from 'vitest'
import { parseDiffLines } from '@/utils/parseDiffLines'

describe('parseDiffLines', () => {
  it('应该返回空数组当 diff 为空', () => {
    expect(parseDiffLines('')).toEqual([])
    expect(parseDiffLines(null as unknown as string)).toEqual([])
    expect(parseDiffLines(undefined as unknown as string)).toEqual([])
  })

  it('应该解析新增行', () => {
    const diff = '+new line'
    const result = parseDiffLines(diff)
    expect(result).toEqual([{ type: 'add', content: '+new line' }])
  })

  it('应该解析删除行', () => {
    const diff = '-old line'
    const result = parseDiffLines(diff)
    expect(result).toEqual([{ type: 'delete', content: '-old line' }])
  })

  it('应该解析上下文行', () => {
    const diff = ' context line'
    const result = parseDiffLines(diff)
    expect(result).toEqual([{ type: 'context', content: ' context line' }])
  })

  it('应该解析混合行', () => {
    const diff = '@@ -1,3 +1,4 @@\n line1\n+new line\n-old line\n line2'
    const result = parseDiffLines(diff)
    expect(result).toEqual([
      { type: 'meta', content: '@@ -1,3 +1,4 @@' },
      { type: 'context', content: ' line1' },
      { type: 'add', content: '+new line' },
      { type: 'delete', content: '-old line' },
      { type: 'context', content: ' line2' },
    ])
  })

  it('应该处理只有新增行的 diff', () => {
    const diff = '+line1\n+line2\n+line3'
    const result = parseDiffLines(diff)
    expect(result).toEqual([
      { type: 'add', content: '+line1' },
      { type: 'add', content: '+line2' },
      { type: 'add', content: '+line3' },
    ])
  })

  it('应该处理只有删除行的 diff', () => {
    const diff = '-line1\n-line2\n-line3'
    const result = parseDiffLines(diff)
    expect(result).toEqual([
      { type: 'delete', content: '-line1' },
      { type: 'delete', content: '-line2' },
      { type: 'delete', content: '-line3' },
    ])
  })

  it('应该处理只有上下文行的 diff', () => {
    const diff = ' line1\n line2\n line3'
    const result = parseDiffLines(diff)
    expect(result).toEqual([
      { type: 'context', content: ' line1' },
      { type: 'context', content: ' line2' },
      { type: 'context', content: ' line3' },
    ])
  })

  it('应该把 diff 文件头(---/+++)和 hunk 标记(@@)识别为 meta 而非 add/delete', () => {
    // --- a/file.ts 和 +++ b/file.ts 是文件头,@@ ... @@ 是 hunk 标记,
    // 它们虽以 -/+ 开头但不是真正的增删行,不应被染成红/绿背景
    const diff =
      '--- a/file.ts\n+++ b/file.ts\n@@ -1,3 +1,4 @@\n line1\n+new line\n-old line\n line2'
    const result = parseDiffLines(diff)
    expect(result).toEqual([
      { type: 'meta', content: '--- a/file.ts' },
      { type: 'meta', content: '+++ b/file.ts' },
      { type: 'meta', content: '@@ -1,3 +1,4 @@' },
      { type: 'context', content: ' line1' },
      { type: 'add', content: '+new line' },
      { type: 'delete', content: '-old line' },
      { type: 'context', content: ' line2' },
    ])
  })

  it('三个减号开头的删除行(---x,无空格)不被误判为文件头', () => {
    // "---x" 以 '---' 开头但无空格,不匹配 '--- ' 文件头模式 → 视为普通删除行
    const diff = '---removed\n-old normal'
    const result = parseDiffLines(diff)
    expect(result[0]).toEqual({ type: 'delete', content: '---removed' })
    expect(result[1]).toEqual({ type: 'delete', content: '-old normal' })
  })
})
