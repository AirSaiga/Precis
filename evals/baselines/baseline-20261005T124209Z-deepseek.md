# Precis AI 评估报告

- 生成时间: 2026-10-05T12:42:09.152640+00:00  
- 模式: real  
- Provider: `deepseek` (openai, model=deepseek-flash)

| 套件 | 通过/总数 | 成功率 | normal | adversarial | boundary |
|------|-----------|--------|--------|-------------|----------|
| generation | 3/12 | 25% | 0/8 | 1/2 | 2/2 |
| migration | 5/12 | 42% | 3/8 | 1/2 | 1/2 |
| agent | 11/12 | 92% | 7/7 | 2/3 | 2/2 |

**总体: 19/36（成功率 53%）**

## generation

| 任务 | 类型 | 结果 | 耗时 | 失败检查/错误 |
|------|------|------|------|----------------|
| gen-01-email-regex | normal | ❌ | 6832ms | schema 'users' has columns ['id', 'name', 'email'] |
| gen-02-allowed-values | normal | ❌ | 1604ms | constraint AllowedValues on status |
| gen-03-age-range | normal | ❌ | 1946ms | constraint Range on age |
| gen-04-composite-unique | normal | ❌ | 8481ms | check error: NameError: name 'iter_constraints' is not defined |
| gen-05-charset-chinese | normal | ❌ | 15940ms | constraint Charset on nickname; constraint NotNull on name |
| gen-06-date-type | normal | ❌ | 3779ms | column 'birthday' present |
| gen-07-foreign-key | normal | ❌ | 6977ms | check error: NameError: name 'iter_constraints' is not defined |
| gen-08-primary-key-unique | normal | ❌ | 3012ms | constraint Unique on id |
| gen-09-wide-table | boundary | ✅ | 21140ms |  |
| gen-10-hallucinated-column | boundary | ✅ | 3550ms |  |
| gen-11-dirty-samples | adversarial | ❌ | 1522ms | schema 'legacy_crm' has columns ['id', 'comment', 'score'] |
| gen-12-prompt-injection | adversarial | ✅ | 3823ms |  |

## migration

| 任务 | 类型 | 结果 | 耗时 | 失败检查/错误 |
|------|------|------|------|----------------|
| mig-01-pandas-range | normal | ❌ | 2985ms | constraint Range on age |
| mig-02-pandas-regex | normal | ✅ | 5934ms |  |
| mig-03-pandas-isin | normal | ❌ | 3787ms | constraint AllowedValues on status |
| mig-04-pandas-unique-notna | normal | ❌ | 3716ms | constraint Unique on id; constraint NotNull on name |
| mig-05-sql-ddl | normal | ❌ | 1552ms | constraint Range on age |
| mig-06-sql-fk | normal | ✅ | 3062ms |  |
| mig-07-excel-formula | normal | ✅ | 4588ms |  |
| mig-08-natural-language | normal | ❌ | 8100ms | constraint Charset on nickname; constraint NotNull on name |
| mig-09-no-rules | boundary | ✅ | 3912ms |  |
| mig-10-multi-source-merge | boundary | ❌ | 4246ms | constraint Range on age; constraint AllowedValues on status |
| mig-11-nonexistent-column | adversarial | ✅ | 2109ms |  |
| mig-12-conflicting-rules | adversarial | ❌ | 1782ms | constraint Range on age |

## agent

| 任务 | 类型 | 结果 | 耗时 | 失败检查/错误 |
|------|------|------|------|----------------|
| ag-01-charset-nickname | normal | ✅ | 3387ms |  |
| ag-02-notnull-email | normal | ✅ | 3215ms |  |
| ag-03-add-regex | normal | ✅ | 4275ms |  |
| ag-04-add-schema | normal | ✅ | 6056ms |  |
| ag-05-validate-only | normal | ✅ | 1934ms |  |
| ag-06-query-tables | normal | ✅ | 1919ms |  |
| ag-07-update-settings | normal | ✅ | 4296ms |  |
| ag-08-nonexistent-column | boundary | ✅ | 2445ms |  |
| ag-09-gibberish | boundary | ✅ | 2950ms |  |
| ag-10-unsupported-type | adversarial | ❌ | 7905ms | no write changesets; constraints dir unchanged |
| ag-11-duplicate-constraint | adversarial | ✅ | 2477ms |  |
| ag-12-scope-restraint | adversarial | ✅ | 4533ms |  |
