# CI 测试功能完整性 — qa_simple 作为单元/集成/E2E 统一基准

> 状态：设计已确认，待写实现计划
> 日期：2026-06-23
> 作者：ZCode 协作产出

## 1. 背景与目标

目标：确认 CI 具备完整的测试功能，使 `qa_test/qa_simple/` 作为后端单元/集成测试、前端 vitest、E2E Playwright、`cli:validate` 冒烟的**统一基准**，且 CI 全绿。

对四个测试套件做了本地实跑审计，结果如下：

| 套件 | 命令 | 实测结果 | 结论 |
|------|------|---------|------|
| 后端 pytest | `python -m pytest` | 2515 passed, 1 skipped (44s) | ✅ 绿 |
| 前端 vitest | `npm run test -- --run` | 104 文件 / 1412 passed (21s) | ✅ 绿 |
| `cli:validate` / CI smoke | `app.cli validate ...qa_simple` | exit **1** | ❌ CI 必然失败 |
| E2E Playwright | `npx playwright test` | 12 failed / 120 passed / 14 skipped | ❌ 失败 |

### 三个根因

- **根因 A — CI smoke 退出码语义冲突（阻断 CI）**
  `ci.yml:94-98` 直接跑 `app.cli validate`，无 `continue-on-error`。而 `ValidateCommand` 在 qa_simple 故意违规存在时返回 `CommandResult.error` → 进程 exit 1。因此 main 分支 backend job 当前应该是红的。

- **根因 B — E2E 共享 fixture 无隔离（12 个失败中 9 个的直接原因）**
  全部 E2E 指向同一个 live `qa_test/qa_simple/`。写测试（constraint/schema/transform CRUD）通过 API 往该目录写文件，读测试（full-lifecycle）又从同一目录读。并行 worker + 串行执行导致：
  - 跑完一次 E2E，fixture 里多出 **15 个垃圾文件**（`c-charset.constraint.yaml`、`e2e_update.schema.yaml`、整个 `regex/` 目录等）。
  - 隔离单跑 `full-lifecycle.spec.ts` 只有 2 个真失败；混跑变 11 个。差额 9 个全是污染所致。

- **根因 C — 3 个真实测试 bug（本次仅修 1 个，另 2 个标注暂挂）**
  1. `validation.spec.ts:58` `validation handles missing column gracefully`：`ReferenceError: USERS_CSV is not defined` —— 确定的代码缺陷（漏解构 `testProjectPath`、却引用未定义的 `USERS_CSV`）。**本次修。**
  2. `full-lifecycle.spec.ts:423` Stage 5 Regex roundtrip：断言 `source_ref` 字段存在，实际 `undefined`。需查后端 regex schema 是否有此字段。**本次不修。**
  3. `full-lifecycle.spec.ts:551` 完整性端点：`expect(...).toBe(...)` 不匹配。需查后端该端点实现。**本次不修。**

## 2. 范围

**本次范围内（修）**：
- 根因 A：CI smoke 改为 golden 断言，使 qa_simple 成为回归基线。
- 根因 B：E2E 全量隔离（所有测试用副本，原件永不被 API 指向）。
- 根因 C-1：修 `validation.spec.ts:58` 的 `USERS_CSV` bug。
- 根因 C-2、C-3：用 `test.fixme` 标注并注明原因，保证 CI 不因它们变红。

**本次范围外（不修，仅记录）**：
- 根因 C-2、C-3 的后端实现层修复（regex `source_ref` 字段、完整性端点响应）。
- 后端 per-request 工作区 / memory-fs 等架构改造。
- golden 断言对校验器输出格式细节的全面固化（仅覆盖"预期的 4 类违规签名"）。

## 3. 设计

### 3.1 根因 A — CI smoke 改为 golden 断言

**机制**：新增一个校验脚本，跑 `app.cli validate` 针对原件 qa_simple，捕获输出，断言"产出期望的那一组错误"，而非要求 exit 0。

**断言内容（golden 基线）**：
1. 进程不崩溃（能正常打印摘要、不抛未捕获异常）。
2. 校验摘要里包含预期的违规签名，至少覆盖：
   - `orders_fk_ghost` 引用 `ghost_table` 的 `ReferenceIntegrityError`（ghost FK）。
   - `inventory.item_id` 的 2 个 `ForeignKey` 错误（I001/I002）。
   - `orders` 因 `SchemaSourceDuplicate` 被跳过后级联的 `ConstraintConfig`（表不在数据集中）。
   - `SchemaSourceDuplicate` 警告本身。
3. errors 总数在预期区间（当前 15 个，断言 `>= 10` 且 `<= 25` 容忍小幅波动）。
4. exit code 非 0 是**预期**的（有校验错误 → exit 1），脚本不据此判失败；脚本只在"断言不满足 / 进程崩溃"时 exit 非 0。

**实现形态**：优先用 Python 脚本（与后端同栈，可直接 import `app.cli` 拿 `CommandResult.data` 结构化数据，避免解析 stdout 的脆弱性）。若 CLI 当前已支持结构化输出（`CommandResult.data` 携带 errors 列表），直接断言；否则评估加 `--json` 开关的成本。具体输出接口在实现计划阶段确认。

**CI 改动**：`ci.yml` 的 smoke 步骤改为跑该校验脚本（替代裸 `app.cli validate`）。`package.json` 新增 `cli:validate:check` 脚本封装。裸 `cli:validate` 保留（人工排查用）。

**回归价值**：校验器若改坏（漏报 ghost FK、误报、错误格式变更是契约破坏），smoke 立即红。

### 3.2 根因 B — E2E 全量副本隔离

**核心原则**：原件 `qa_test/qa_simple/` 永远只作为拷贝源，任何测试都不通过 `X-Project-Config-Path` 指向它。**所有** spec（读 + 写）都从各自副本运行。

**机制**（`e2e/fixtures/base.ts`）：
1. 导出唯一常量 `QA_SIMPLE_SOURCE` = 原件绝对路径（仅用于拷贝源）。
2. 新增 fixture `isolatedProjectPath`：
   - `before`（spec 文件级别）：`fs.cpSync(QA_SIMPLE_SOURCE, tmpDir, { recursive: true })`，副本路径基于 `os.tmpdir()` 或 `e2e/.test-projects/<spec-slug>-<pid>`，确保并行 worker 不冲突。
   - 返回副本路径。
   - `after`：`fs.rmSync(tmpDir, { recursive: true, force: true })` 清理。
3. 现有 `testProjectPath` fixture 改为 `isolatedProjectPath` 的别名/等价物（向后兼容，但语义统一为"副本"）。
4. `apiHelper` 的 `X-Project-Config-Path` header 改用副本路径（通过 fixture 注入，而非硬编码原件）。

**路径解析统一**：当前 11+ 个 spec 各自 `path.resolve(__dirname, ...)` 拼 qa_simple 路径。统一改为从 `base.ts` 导入（写测试用 `isolatedProjectPath` fixture；个别需要原件路径做磁盘校验的只读断言，用 `QA_SIMPLE_SOURCE`）。

**`.precis/` 运行时目录**：副本里自然包含（cpSync 连同拷贝），或后端按需创建；关键是后端运行时工件（`validation_history.json`、`workspaces.json`）写到副本而非原件。

**预期效果**：
- full-lifecycle 的 9 个污染性失败消失（读到的是干净 committed fixture）。
- 跑完 E2E 不再产生垃圾文件。
- 并行 worker 安全。

### 3.3 根因 C-1 — 修 `validation.spec.ts:58`

补 `testProjectPath` 解构并定义 `USERS_CSV`，与同文件第 14/28/43 行一致：

```typescript
test('validation handles missing column gracefully', async ({ apiHelper, testProjectPath }) => {
  const USERS_CSV = path.join(testProjectPath, 'data', 'users.csv')
  ...
```

（在 §3.2 落地后，`testProjectPath` 即副本路径。）

### 3.4 根因 C-2、C-3 — `test.fixme` 标注

对 2 个真失败用 `test.fixme(..., '原因')` 标注，注明：
- `full-lifecycle.spec.ts:423` —— 断言 regex `source_ref` 字段，实际 undefined；待查后端 regex schema 是否有此字段。
- `full-lifecycle.spec.ts:551` —— 完整性端点响应与断言不符；待查后端该端点实现。

`test.fixme` 会标记为跳过并在报告里显示原因，CI 不变红、信息不丢失。后续单独开任务修复后端。

## 4. 验证标准

实现完成后，本地依次跑通且 CI 预期全绿：

1. `python -m pytest`（backend）—— 保持 2515 passed（±少量因 fixme 调整）。
2. `npm run test -- --run`（frontend）—— 保持 1412 passed。
3. `npm run cli:validate:check`（新增 golden 脚本）—— exit 0。
4. `npx playwright test`（e2e）—— **0 failed**（2 个 fixme 跳过、其余全绿）。
5. 跑完 e2e 后 `git status` 干净（无垃圾文件）。
6. `ci.yml` 的 backend smoke 步骤改跑 golden 脚本，预期绿。

## 5. 已知限制 / 遗留项

- 根因 C-2（regex `source_ref` 字段）与 C-3（完整性端点）的后端实现层修复未做，以 `test.fixme` 暂挂。
- golden 断言覆盖"预期的 4 类违规签名 + 总数区间"，未固化校验器输出的全部字段细节。
- 本地 backend 启动用的是 Python 3.13.5，CI 用 3.12；行为差异未单独验证（既有测试在 3.12 CI 上历史可用）。

## 6. 风险

- **副本拷贝成本**：qa_simple 较小（几十个小 YAML + 几个 CSV/JSON），`cpSync` 毫秒级，相对单测网络往返可忽略。若后续 fixture 膨胀需重新评估。
- **CLI 结构化输出**：若 `app.cli validate` 当前无结构化输出，golden 脚本需解析 stdout 或加 `--json` 开关——实现计划阶段先探明现状，避免脆弱的字符串匹配。
- **路径统一改动面**：11+ 个 spec 改 import，需逐文件确认其语义（读 vs 写、需原件 vs 副本）。
