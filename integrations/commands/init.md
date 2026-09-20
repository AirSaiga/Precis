---
description: 引导创建 Precis 校验项目（推断 schema + 写约束 + 首次校验）
---

请按 `precis-data-validation` skill 的工作流为 $ARGUMENTS 初始化校验项目：

1. 前置检查：`precis --version`（不可用则依次尝试 `uvx --from precis-cli precis --version`，
   都不行给安装指引并停止）。
2. 向用户确认配置落盘位置（默认建议数据文件旁的 `precis-project/`）。
3. **先推断再调整**：执行 `precis infer-schema <数据文件> --output <目录>/schemas/<表名>.schema.yaml`
   生成 schema 草稿（列类型自动推断，含少量脏值时的主导类型采信），
   展示推断结果给用户确认，再按业务语义调整（如 id 列补 primary_key、
   需要精确金额的列改 decimal）。
4. 与用户确认需要哪些约束（非空/唯一/枚举/区间/外键等），按 skill 的
   references/v2-format.md 写 `constraints/*.constraint.yaml` 与
   `project.precis.yaml`（ID 用 UUID v4；先推断的 schema 已带 UUID，manifest 引用它即可）。
5. 执行 `precis validate --manifest <path> --format json` 完成首次校验，
   按退出码 0/1/2 用中文汇报结果。
