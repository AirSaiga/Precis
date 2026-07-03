// @file codegen.mjs
// @description 从后端 actions registry 生成前端 TS 类型与常量
//
// 设计说明:
// - 后端 registry.py 是动作类型单一事实源,本脚本通过 subprocess 调用
//   export_for_codegen() 读取,生成 frontend/src/types/generated/actions.ts
// - 改后端动作类型后跑 `npm run codegen` 重新生成,CI 会校验生成物与提交一致
// - 生成物禁止手改(文件头有标注)

import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const frontendRoot = path.resolve(__dirname, '..')
const repoRoot = path.resolve(frontendRoot, '..')
const backendRoot = path.join(repoRoot, 'backend')
const outDir = path.join(frontendRoot, 'src', 'types', 'generated')
const outFile = path.join(outDir, 'actions.ts')

// 通过 subprocess 调用后端 registry.export_for_codegen(),拿到 JSON
// cwd=backend 保证能 import app.* 模块
function readRegistry() {
  const py = (
    'import json; ' +
    'from app.shared.services.llm.actions.registry import export_for_codegen; ' +
    'print(json.dumps(export_for_codegen()))'
  )
  const stdout = execSync(`python -c "${py}"`, {
    cwd: backendRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return JSON.parse(stdout)
}

function fmtStringList(items) {
  return items.map((t) => `  | '${t}'`).join('\n')
}

function fmtArray(items) {
  return `[${items.map((t) => `'${t}'`).join(', ')}]`
}

function generate(data) {
  const all = data.all_action_types
  const union = fmtStringList(all)
  const byCategory = data.by_category
  const readOnly = data.read_only_action_types
  const write = data.write_action_types

  const lines = []
  lines.push('/**')
  lines.push(' * @file actions.ts — 自动生成,禁止手改')
  lines.push(' *')
  lines.push(' * 由 frontend/scripts/codegen.mjs 从后端 registry.py 生成。')
  lines.push(' * 改动作类型后跑 `npm run codegen` 重新生成;CI 会校验生成物与提交一致。')
  lines.push(' */')
  lines.push('')
  lines.push('// 动作类型联合(单一事实源:后端 registry.ACTIONS)')
  lines.push(`export type ActionType =\n${union}`)
  lines.push('')
  lines.push('// 全部动作类型列表(顺序与后端 ACTIONS 插入序一致)')
  lines.push(`export const ALL_ACTION_TYPES: ActionType[] = ${fmtArray(all)}`)
  lines.push('')
  // 按 category 生成各分类 Set
  for (const [cat, types] of Object.entries(byCategory)) {
    // 只生成 codegen 范围内的 4 个 CRUD 家族 + 通用 read/write
    // (settings/canvas/validate 各只 1 个动作,前端用字面量比较即可,无需 Set)
    if (!['constraint', 'schema', 'regex', 'transform'].includes(cat)) continue
    const constName = `${cat.toUpperCase()}_ACTION_TYPES`
    lines.push(`export const ${constName}: ReadonlySet<ActionType> = new Set(${fmtArray(types)})`)
    lines.push('')
  }
  lines.push(`export const READ_ONLY_ACTION_TYPES: ReadonlySet<ActionType> = new Set(${fmtArray(readOnly)})`)
  lines.push('')
  lines.push(`export const WRITE_ACTION_TYPES: ReadonlySet<ActionType> = new Set(${fmtArray(write)})`)
  lines.push('')

  return lines.join('\n')
}

function main() {
  const data = readRegistry()
  const content = generate(data)
  mkdirSync(outDir, { recursive: true })
  writeFileSync(outFile, content, 'utf8')
  console.log(`[codegen] 已生成 ${path.relative(repoRoot, outFile)}`)
  console.log(`[codegen] 动作类型 ${data.all_action_types.length} 个`)
}

main()
