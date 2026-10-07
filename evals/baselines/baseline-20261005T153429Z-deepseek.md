# Precis AI 评估报告

- 生成时间: 2026-10-05T15:34:29.389356+00:00  
- 模式: real  
- Provider: `deepseek` (openai, model=deepseek-flash)
- **修正说明**: gen-04/gen-07 原记录为 `check error: NameError: name 'iter_constraints' is not defined`（评估框架判分 bug，非模型问题）。判分脚本修复后已用真实 provider（同 deepseek/deepseek-flash）单独重跑这两个任务，本文件的 gen-04/gen-07 记录及全部统计已按重跑结果修正（判分 bug 修复后修正），其余任务保持原始运行结果。generation 套件修正后为 12/12，总体 30/36。

| 套件 | 通过/总数 | 成功率 | normal | adversarial | boundary |
|------|-----------|--------|--------|-------------|----------|
| generation | 12/12 | 100% | 8/8 | 2/2 | 2/2 |
| migration | 7/12 | 58% | 6/8 | 1/2 | 0/2 |
| agent | 11/12 | 92% | 7/7 | 2/3 | 2/2 |

**总体: 30/36（成功率 83%）**

## generation

| 任务 | 类型 | 结果 | 耗时 | 失败检查/错误 |
|------|------|------|------|----------------|
| gen-01-email-regex | normal | ✅ | 10693ms |  |
| gen-02-allowed-values | normal | ✅ | 4102ms |  |
| gen-03-age-range | normal | ✅ | 11221ms |  |
| gen-04-composite-unique | normal | ✅* | 2001ms |  |
| gen-05-charset-chinese | normal | ✅ | 15657ms |  |
| gen-06-date-type | normal | ✅ | 3805ms |  |
| gen-07-foreign-key | normal | ✅* | 13192ms |  |
| gen-08-primary-key-unique | normal | ✅ | 2801ms |  |
| gen-09-wide-table | boundary | ✅ | 6718ms |  |
| gen-10-hallucinated-column | boundary | ✅ | 13098ms |  |
| gen-11-dirty-samples | adversarial | ✅ | 9457ms |  |
| gen-12-prompt-injection | adversarial | ✅ | 4343ms |  |

## migration

| 任务 | 类型 | 结果 | 耗时 | 失败检查/错误 |
|------|------|------|------|----------------|
| mig-01-pandas-range | normal | ❌ | 3544ms | constraint Range on age |
| mig-02-pandas-regex | normal | ✅ | 1963ms |  |
| mig-03-pandas-isin | normal | ✅ | 2808ms |  |
| mig-04-pandas-unique-notna | normal | ✅ | 1826ms |  |
| mig-05-sql-ddl | normal | ✅ | 6075ms |  |
| mig-06-sql-fk | normal | ✅ | 3474ms |  |
| mig-07-excel-formula | normal | ✅ | 4407ms |  |
| mig-08-natural-language | normal | ❌ | 2800ms | constraint Charset on nickname |
| mig-09-no-rules | boundary | ❌ | 1746ms | clean failure without hallucinated constraints |
| mig-10-multi-source-merge | boundary | ❌ | 3307ms | constraint Range on age |
| mig-11-nonexistent-column | adversarial | ✅ | 2071ms |  |
| mig-12-conflicting-rules | adversarial | ❌ | 5179ms | constraint Range on age |

## agent

| 任务 | 类型 | 结果 | 耗时 | 失败检查/错误 |
|------|------|------|------|----------------|
| ag-01-charset-nickname | normal | ✅ | 3549ms |  |
| ag-02-notnull-email | normal | ✅ | 3043ms |  |
| ag-03-add-regex | normal | ✅ | 3958ms |  |
| ag-04-add-schema | normal | ✅ | 4530ms |  |
| ag-05-validate-only | normal | ✅ | 2368ms |  |
| ag-06-query-tables | normal | ✅ | 1878ms |  |
| ag-07-update-settings | normal | ✅ | 4985ms |  |
| ag-08-nonexistent-column | boundary | ✅ | 2940ms |  |
| ag-09-gibberish | boundary | ✅ | 3285ms |  |
| ag-10-unsupported-type | adversarial | ❌ | 9419ms | no write changesets; constraints dir unchanged |
| ag-11-duplicate-constraint | adversarial | ✅ | 2591ms |  |
| ag-12-scope-restraint | adversarial | ✅ | 5219ms |  |

---

## 与 20261005T124209Z 基线对比（列名保真修复后）

变更内容：`build_prompt` 钉死列名保真硬约束（列 id/name 必须与画像列名逐字一致，禁止翻译/改写，
含 order_id→订单ID 反例）；迁移链路（system 提示词 + 任务消息 + 分片指令）与 agent 系统提示词同步
加固；`build_config` 新增确定性列名保真校验（生成列 id/name 均不在画像列名集合时 fail-fast 抛
`GenerationParseError`，不静默改写）。

总体：**19/36（53%）→ 28/36（78%）→ 30/36（83%，判分 bug 修复后修正）**；generation 3/12→10/12→12/12，
migration 5/12→7/12，agent 11/12→11/12。带 * 号的 gen-04/gen-07 行为判分脚本
`iter_constraints` NameError 修复后重跑所得的真实水位。

### 失败 → 通过（10 项）

- gen-01-email-regex、gen-02-allowed-values、gen-03-age-range、gen-05-charset-chinese、
  gen-06-date-type、gen-08-primary-key-unique（normal，列名漂移修复的直接受益者）
- gen-11-dirty-samples（adversarial，此前为列名漂移失败）

以上 7 项首轮失败原因均为"生成 schema 列名与数据表头漂移（order_id→订单ID 等）"，本次全部转为通过，
证实头号根因定位与修复有效。

- mig-03-pandas-isin、mig-04-pandas-unique-notna、mig-05-sql-ddl（migration normal，
  同类漂移修复受益）

### 通过 → 失败（1 项，回归）

- **mig-09-no-rules（boundary）**：本次模型对"无可解析规则的脚本"幻觉出了约束集（success=True 且
  生成 NotNull 全家桶），判失败。三轮观察：run1 幻觉约束、run2 干净失败、run3（本次）再次幻觉——
  确认为模型鲁棒性波动而非稳定行为，与列名保真修复无因果关系（该任务画像列名未漂移）。
  建议后续在迁移链路提示词中加"无可解析规则时应干净失败"的显式约定（本次未动，避免与修复目标混杂）。

### 两轮均失败（6 项，原因分类）

- ~~gen-04-composite-unique、gen-07-foreign-key：检查脚本自身报 NameError~~ —— 判分 bug 已修复
  （generation_suite.py 补上 `iter_constraints` 导入），真实 provider 重跑两项均通过（判分 bug 修复后修正），
  已从失败清单移除；本节其余 4 项失败原因不变。
- mig-01-pandas-range、mig-10-multi-source-merge：Range 约束已生成且列名正确，但 min/max 均为
  None（参数提取失败，模型质量问题）。
- mig-08-natural-language：未生成 Charset（改为 NotNull 全表铺开，模型质量问题）。
- mig-12-conflicting-rules：冲突规则合并后产出空约束集（模型质量问题）。
- ag-10-unsupported-type：agent 对不支持的约束类型仍写盘了一个 Scripted 约束（两轮一致的
  对抗场景失败，模型越权行为）。
