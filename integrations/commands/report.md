---
description: 生成并展示 Precis 校验报告（HTML/Excel 可分享文件）
---

请为 $ARGUMENTS 生成 Precis 校验报告：

1. 前置检查：`precis --version`（不可用则给安装指引并停止）。
2. 目标是数据文件时，先按 `precis-data-validation` skill 确认/生成配置；
   是 project.precis.yaml 时直接进入下一步。
3. 执行（报告格式按扩展名分派，`.html` 单文件可分享，`.xlsx` 每表一个 sheet、违规行标红）：

   ```bash
   precis validate --manifest <path> --format json --report <输出路径>.html
   ```

4. 解析 stdout JSON，用中文向用户汇总（结论、检查数、违规分布），
   并告知报告文件路径（HTML 可直接发给非技术同事打开）。
5. 用户要求 Excel 时改用 `--report <路径>.xlsx` 重跑。
