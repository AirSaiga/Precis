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
// npm 依赖安全审计门禁（带临时豁免白名单）：
// - 等价于 `npm audit --audit-level=moderate`，但在判定前先剔除白名单通告
// - 白名单只收「上游无修复版、且不影响线上运行时」的 dev 工具链通告，
//   通告修复版发布后应立即移除白名单（每项均注明移除条件）
// - `--no-allowlist` 跳过白名单，用于复核全量真实状态
import { execSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

// 临时豁免通告：GHSA id → { reason（豁免理由）, removeWhen（移除条件） }
const ALLOWLIST = {
  'GHSA-vfj7-8cjw-p6xm': {
    reason:
      'braces 栈耗尽 DoS（CVE-2026-93687）：上游截至 2026-10-03 无修复版（latest 3.0.3 即 last_affected），仅 dev 工具链（eslint/fast-glob/micromatch），不影响运行时产物',
    removeWhen: 'braces 发布 ≥3.0.4 后：移除本条，并在根 package.json overrides 钉版 braces ^3.0.4',
  },
}

const noAllowlist = process.argv.includes('--no-allowlist')

// 严重度排序：low < moderate < high < critical，门禁阈值为 moderate
const SEVERITY_ORDER = { low: 1, moderate: 2, high: 3, critical: 4 }
const THRESHOLD = SEVERITY_ORDER.moderate

/** 跑 npm audit --json，返回解析后的报告对象（npm audit 发现漏洞时退出码非 0，属预期） */
function runNpmAudit() {
  let stdout
  try {
    // Windows 上 npm 是 .cmd 脚本，须经 shell 执行（与 codegen.mjs 的 execSync 模式一致）
    stdout = execSync('npm audit --json', { cwd: projectRoot, encoding: 'utf8' })
  } catch (err) {
    // 退出码非 0 时 npm 仍把 JSON 报告打到 stdout
    stdout = err.stdout ?? ''
  }
  if (!stdout.trim()) {
    console.error('npm audit 无输出：请检查网络与 registry（审计端点须支持 /-/npm/v1/security/*）。')
    process.exit(1)
  }
  const report = JSON.parse(stdout)
  if (report.error) {
    console.error(`npm audit 报错：${report.error.code ?? ''} ${report.error.summary ?? ''}`)
    process.exit(1)
  }
  return report
}

/** 从 advisory 的 via 对象提取通告 id（GHSA-xxx 或 npm 数字 id） */
function advisoryId(via) {
  const match = /(?:GHSA-[a-z0-9-]+|\d+)\s*$/.exec(via.url ?? '')
  return match ? match[0] : ''
}

// —— 主流程 ——
const report = runNpmAudit()
const vulnerabilities = report.vulnerabilities ?? {}

// 不动点剔除：某包「干净」= 其所有 via 均为白名单通告，或指向已判干净的包
const clean = new Set()
let changed = true
while (changed) {
  changed = false
  for (const [name, info] of Object.entries(vulnerabilities)) {
    if (clean.has(name)) continue
    const allClean = (info.via ?? []).every((via) => {
      if (typeof via === 'string') return clean.has(via)
      return !noAllowlist && ALLOWLIST[advisoryId(via)] !== undefined
    })
    if (allClean) {
      clean.add(name)
      changed = true
    }
  }
}

// 剩余（未豁免）漏洞中是否存在达到阈值的
const remaining = Object.entries(vulnerabilities).filter(([name]) => !clean.has(name))
const failing = remaining.filter(([, info]) => SEVERITY_ORDER[info.severity] >= THRESHOLD)

// 汇总输出
const exemptedCount = Object.keys(vulnerabilities).length - remaining.length
if (exemptedCount > 0) {
  console.log(`豁免通告（白名单）：${Object.keys(ALLOWLIST).length} 条，关联豁免包：${exemptedCount} 个`)
  for (const [id, entry] of Object.entries(ALLOWLIST)) {
    console.log(`  - ${id}: ${entry.reason}`)
    console.log(`    移除条件：${entry.removeWhen}`)
  }
}

if (failing.length > 0) {
  console.error(`npm 依赖安全审计失败：${failing.length} 个包存在 ≥moderate 漏洞（白名单外）。`)
  for (const [name, info] of failing) {
    const advisoryTitles = (info.via ?? [])
      .filter((via) => typeof via !== 'string')
      .map((via) => `${advisoryId(via)} ${via.title}`)
      .join('; ')
    console.error(`  - ${name}（${info.severity}，range ${info.range}）${advisoryTitles}`)
  }
  process.exit(1)
}

console.log('npm 依赖安全审计通过。')
