/**
 * L04 注入测试 — connectionPolicyService.sanitizeConnections 的行为等价（golden-master）
 * 与千边量级耗时测量。
 *
 * 本文件由 challenges/L04-perf-connection-sanitize/verify.mjs 在评分期间临时复制到
 * frontend/tests/services/canvas/，跑完即删。禁止修改本文件；golden 参照实现
 * （referenceSanitize）是对"现状实现"行为的固化副本，用来对比优化后的结果。
 */
import { describe, it, expect, vi } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Connection, Node } from '@vue-flow/core'

// 静默日志：验证器每条连接打 8+ 条 debug 日志，日志 I/O 不是本题优化目标，
// 不 mock 的话会淹没纯算法耗时对比（也让 verify 输出干净）。
vi.mock('@/core/utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import {
  connectionPolicyService,
  type InvalidConnection,
} from '@/services/canvas/connectionPolicyService'
import { getRulesForSourceNodeType, type ConnectionRule } from '@/services/rules'

// 耗时结果落点：frontend/.l04_timing_result.json（verify.mjs 以 cwd=frontend 运行 vitest）
const RESULT_PATH = join(process.cwd(), '.l04_timing_result.json')

// ---------------------------------------------------------------------------
// golden 参照实现 —— 与"现状实现"行为完全一致的固化副本
// ---------------------------------------------------------------------------

function refIsHandleMatchingPattern(handle: string, pattern: string): boolean {
  if (!pattern.includes('{')) {
    return pattern === handle
  }
  const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  let regexSource = '^'
  let lastIndex = 0
  const placeholderRegex = /\{[^}]+\}/g
  let match: RegExpExecArray | null
  while ((match = placeholderRegex.exec(pattern)) !== null) {
    regexSource += escapeRegex(pattern.slice(lastIndex, match.index)) + '(.+)'
    lastIndex = placeholderRegex.lastIndex
  }
  regexSource += escapeRegex(pattern.slice(lastIndex)) + '$'
  return new RegExp(regexSource).test(handle)
}

function refIsHandleAllowed(handle: string | undefined, allowedHandles: string[]): boolean {
  if (handle === undefined) return false
  return allowedHandles.some((pattern) => refIsHandleMatchingPattern(handle, pattern))
}

function refFindMatchingRule(
  sourceNode: Node,
  sourceHandle: string | undefined,
  targetNode: Node,
  targetHandle: string | undefined
): ConnectionRule | null {
  const sourceRules = getRulesForSourceNodeType(sourceNode.type ?? '')
  for (const rule of sourceRules) {
    if (!rule.target.nodeTypes.some((t) => t === targetNode.type)) {
      continue
    }
    if (rule.target.handles && rule.target.handles.length > 0) {
      if (targetHandle && !refIsHandleAllowed(targetHandle, rule.target.handles)) {
        continue
      }
    }
    if (rule.source.handles && rule.source.handles.length > 0) {
      if (sourceHandle && !refIsHandleAllowed(sourceHandle, rule.source.handles)) {
        continue
      }
    }
    return rule
  }
  return null
}

function refValidateConnection(
  sourceNode: Node,
  sourceHandle: string | undefined,
  targetNode: Node,
  targetHandle: string | undefined,
  existing: Connection[]
): boolean {
  if (!sourceNode || !targetNode) return false
  if (sourceNode.id === targetNode.id) return false

  const rule = refFindMatchingRule(sourceNode, sourceHandle, targetNode, targetHandle)
  if (!rule) return false

  if (!rule.source.nodeTypes.some((t) => t === sourceNode.type)) return false
  if (!rule.target.nodeTypes.some((t) => t === targetNode.type)) return false

  if (rule.source.handles && rule.source.handles.length > 0) {
    if (!sourceHandle || !refIsHandleAllowed(sourceHandle, rule.source.handles)) return false
  }
  if (rule.target.handles && rule.target.handles.length > 0) {
    if (!targetHandle || !refIsHandleAllowed(targetHandle, rule.target.handles)) return false
  }

  // 多重连接检查：与现状一致——检查的是"整张输入表"（含当前连接自身），
  // 而非逐条累积的前缀。优化实现若改成前缀式判定，golden 对比会立即暴露。
  if (rule.config?.allowMultiple === false) {
    const hasExistingConnection = existing.some(
      (conn) => conn.source === sourceNode.id && conn.target === targetNode.id
    )
    if (hasExistingConnection) return false
  }
  return true
}

function referenceSanitize(nodes: Node[], connections: Connection[]): InvalidConnection[] {
  const validConnections: Connection[] = []
  for (const conn of connections) {
    const sourceNode = nodes.find((n) => n.id === conn.source)
    const targetNode = nodes.find((n) => n.id === conn.target)
    if (!sourceNode || !targetNode) continue
    const ok = refValidateConnection(
      sourceNode,
      conn.sourceHandle ?? undefined,
      targetNode,
      conn.targetHandle ?? undefined,
      connections
    )
    if (ok) validConnections.push(conn)
  }
  const invalid: InvalidConnection[] = []
  for (const conn of connections) {
    const inList = validConnections.some(
      (c) =>
        c.source === conn.source &&
        c.target === conn.target &&
        c.sourceHandle === conn.sourceHandle &&
        c.targetHandle === conn.targetHandle
    )
    if (!inList) {
      invalid.push({ connection: conn, reason: 'Connection validation failed' })
    }
  }
  return invalid
}

// ---------------------------------------------------------------------------
// 构造工具
// ---------------------------------------------------------------------------

function makeNode(id: string, type: string): Node {
  return { id, type, position: { x: 0, y: 0 }, data: {} } as Node
}

function makeConn(
  source: string,
  target: string,
  sourceHandle?: string | null,
  targetHandle?: string | null
): Connection {
  const conn: Connection = { source, target }
  if (sourceHandle !== undefined) conn.sourceHandle = sourceHandle
  if (targetHandle !== undefined) conn.targetHandle = targetHandle
  return conn
}

function checkEquivalent(nodes: Node[], connections: Connection[]) {
  const expected = referenceSanitize(nodes, connections)
  const actual = connectionPolicyService.sanitizeConnections(nodes, connections)
  expect(actual).toEqual(expected)
}

// ---------------------------------------------------------------------------
// 等价场景
// ---------------------------------------------------------------------------

describe('l04 golden 等价', () => {
  it('l04-equiv-all-valid：全合法边集（allowMultiple=true 规则）', () => {
    const nodes = [makeNode('fk', 'foreignKeyConstraint'), makeNode('s1', 'schema'), makeNode('s2', 'schema')]
    const connections = [
      makeConn('fk', 's1'),
      makeConn('fk', 's2'),
      makeConn('fk', 's1'),
      makeConn('fk', 's2'),
    ]
    const expected = referenceSanitize(nodes, connections)
    expect(expected).toHaveLength(0)
    checkEquivalent(nodes, connections)
  })

  it('l04-equiv-mixed-invalid：缺失节点/自连接/无规则/handle 非法混合', () => {
    const nodes = [
      makeNode('s', 'sourcePreview'),
      makeNode('t1', 'schema'),
      makeNode('r', 'regex'),
      makeNode('m', 'manualData'),
    ]
    const connections = [
      makeConn('ghost', 't1'), // 源节点不存在
      makeConn('s', 'ghost2'), // 目标节点不存在
      makeConn('s', 's'), // 自连接
      makeConn('m', 's'), // manualData→sourcePreview 无规则
      makeConn('s', 't1', undefined, 'target-right'), // 目标 handle 非法
      makeConn('s', 't1', null, 'target-left'), // null 源 handle → 合法
      makeConn('s', 't1', undefined, 'target-left'), // 合法
    ]
    checkEquivalent(nodes, connections)
  })

  it('l04-equiv-duplicates-multiplicity：重复边与多重连接判定（整表语义）', () => {
    const nodes = [
      makeNode('fk', 'foreignKeyConstraint'),
      makeNode('s1', 'schema'),
      makeNode('src', 'sourcePreview'),
      makeNode('rg', 'regex'),
    ]
    const connections = [
      makeConn('fk', 's1'),
      makeConn('fk', 's1'), // allowMultiple=true → 两条都合法
      makeConn('src', 's1', undefined, 'target-left'),
      makeConn('src', 's1', undefined, 'target-left'), // allowMultiple=false：整表语义下（含自身）都非法
      makeConn('s1', 'rg', 'source-right-colA', 'regex-input'),
      makeConn('s1', 'rg', 'source-right-colB', 'regex-input'), // 同 (source,target) 不同 handle → 都非法
    ]
    checkEquivalent(nodes, connections)
  })

  it('l04-equiv-boundary-handles：undefined/null handle 与规则约束的边界', () => {
    const nodes = [makeNode('sch', 'schema'), makeNode('rg', 'regex'), makeNode('nn', 'notNullConstraint')]
    const connections = [
      makeConn('sch', 'rg', undefined, 'regex-input'), // 源 handle 缺失 → 非法
      makeConn('sch', 'rg', 'source-right-colA', 'regex-input'), // 合法
      makeConn('sch', 'rg', null, 'regex-input'), // null → 非法
      makeConn('sch', 'nn', 'source-right-colA', 'target-input-abc'), // 占位符 handle → 合法
      makeConn('sch', 'nn', 'source-right-colA', 'target-left'), // 精确 handle → 合法
      makeConn('sch', 'nn', 'source-right-colA', 'target-else-abc'), // 无匹配模式 → 非法
      makeConn('sch', 'nn', 'source-right-colA', undefined), // 目标 handle 缺失 → 非法
    ]
    checkEquivalent(nodes, connections)
  })

  it('l04-equiv-placeholder-order：无效列表顺序与占位符模式', () => {
    const nodes = [
      makeNode('sch', 'schema'),
      makeNode('rg', 'regex'),
      makeNode('re', 'regexExtract'),
      makeNode('nn1', 'notNullConstraint'),
      makeNode('nn2', 'uniqueConstraint'),
    ]
    const connections = [
      makeConn('sch', 'rg', 'source-right-colA', 'regex-input'), // 合法
      makeConn('sch', 'rg', 'source-right-', 'regex-input'), // 占位符 (.+) 匹配空串也算匹配 → 合法
      makeConn('sch', 're', 'source-right-colA', 'regexExtract-input'), // 合法
      makeConn('sch', 'nn1', 'source-right-colA', 'target-if-abc'), // 合法
      makeConn('sch', 'nn2', 'source-right-colA', 'target-then-xyz'), // 合法
      makeConn('sch', 'nn1', 'bad-handle', 'target-left'), // 源 handle 非法 → 非法
      makeConn('sch', 'nn2', 'source-right-colA', 'target-left'), // 合法
    ]
    checkEquivalent(nodes, connections)
  })

  it('l04-equiv-big-generated：确定性大边集（300 边、50 节点）全量对比', () => {
    // 简单 LCG 确定性伪随机，避免每次运行数据不同
    let seed = 42
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648
    }
    const types = ['sourcePreview', 'schema', 'jsonSchema', 'regex', 'regexExtract', 'manualData', 'notNullConstraint', 'foreignKeyConstraint', 'transform', 'transformOutput']
    const nodes = types.slice(0, 10).map((t, i) => makeNode(`n${i}`, t))
    for (let i = 10; i < 50; i++) {
      nodes.push(makeNode(`n${i}`, types[Math.floor(rand() * types.length)]))
    }
    const connections: Connection[] = []
    for (let i = 0; i < 300; i++) {
      const s = nodes[Math.floor(rand() * nodes.length)].id
      const t = nodes[Math.floor(rand() * nodes.length)].id
      const handles = [
        undefined,
        undefined,
        'source-right-colA',
        'target-left',
        'regex-input',
        'target-input-abc',
        null,
      ]
      const sh = handles[Math.floor(rand() * handles.length)]
      const th = handles[Math.floor(rand() * handles.length)]
      connections.push(makeConn(s, t, sh, th))
    }
    checkEquivalent(nodes, connections)
  })
})

// ---------------------------------------------------------------------------
// 耗时测量（千边量级）
// ---------------------------------------------------------------------------

describe('l04 耗时', () => {
  it('l04-timing-measure：3000 边级场景下实现 vs golden 参照耗时', () => {
    const nodes: Node[] = []
    nodes.push(makeNode('fk', 'foreignKeyConstraint'))
    nodes.push(makeNode('sch', 'schema'))
    for (let i = 0; i < 600; i++) nodes.push(makeNode(`nn${i}`, 'notNullConstraint'))
    for (let i = 0; i < 600; i++) nodes.push(makeNode(`rg${i}`, 'regex'))

    const connections: Connection[] = []
    for (let i = 0; i < 1800; i++) connections.push(makeConn('fk', 'sch')) // allowMultiple=true → 全部合法
    for (let i = 0; i < 600; i++) connections.push(makeConn('sch', `nn${i}`, 'source-right-colA', 'target-input-abc'))
    for (let i = 0; i < 600; i++) connections.push(makeConn('sch', `rg${i}`, 'source-right-colA', 'regex-input'))

    const measureOnce = (fn: () => unknown): number => {
      const t0 = performance.now()
      fn()
      return performance.now() - t0
    }

    // 预热（JIT）
    referenceSanitize(nodes, connections)
    connectionPolicyService.sanitizeConnections(nodes, connections)

    // 交替测量 5 轮，各自取最小值，减少 GC/JIT 偏向
    const refTimes: number[] = []
    const optTimes: number[] = []
    for (let i = 0; i < 5; i++) {
      refTimes.push(measureOnce(() => referenceSanitize(nodes, connections)))
      optTimes.push(measureOnce(() => connectionPolicyService.sanitizeConnections(nodes, connections)))
    }
    const refMs = Math.min(...refTimes)
    const optMs = Math.min(...optTimes)
    const ratio = refMs / optMs
    writeFileSync(RESULT_PATH, JSON.stringify({ refMs, optMs, ratio }))
    // 兜底：优化实现在大边集上不得抛异常
    const out = connectionPolicyService.sanitizeConnections(nodes, connections)
    expect(Array.isArray(out)).toBe(true)
  })
})
