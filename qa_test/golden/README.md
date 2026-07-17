# 校验引擎黄金集

每个子目录 `NN_<name>/` 是一个独立的黄金案例，包含：
- `project.precis.yaml` — V2 项目清单（最小化，聚焦单一约束类型）
- `data/` — 数据文件（CSV/JSON/Excel）
- `expected.json` — 期望的校验结果签名

## expected.json schema

```json
{
  "case_id": "01_not_null",
  "description": "NotNull 约束基础用例",
  "expect_success": true,
  "expected_error_count_min": 2,
  "expected_error_count_max": 2,
  "expected_error_types": ["NotNullViolation"],
  "expected_violations": [
    {"table": "users", "column": "name", "type": "NotNullViolation"}
  ],
  "expected_loading_error_types": []
}
```

字段说明：
- `expect_success` — executor.execute 是否应无异常完成（true=正常返回结果，false=应抛异常）
- `expected_error_count_min/max` — 校验错误数量的闭区间
- `expected_error_types` — 应出现的错误类型集合（子集匹配，不要求精确数量）
- `expected_violations` — 应出现的具体违规（table+column+type 三元组，子集匹配）
- `expected_loading_error_types` — 加载阶段应出现的错误类型集合

## 添加新案例

1. 在 `qa_test/golden/` 下新建 `NN_<name>/` 目录（NN 为两位数字序号）
2. 放入 `project.precis.yaml` + `data/` + `expected.json`
3. 运行 `python -m scripts.golden_check --update NN_<name>` 冻结期望（首次）
4. 运行 `python -m scripts.golden_check` 验证全过
