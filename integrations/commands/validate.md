---
description: 用 Precis 校验指定数据文件或项目
---

请按 `precis-data-validation` skill 的工作流校验：$ARGUMENTS

执行要点：

1. 先跑 `precis --version` 确认 CLI 可用；不可用则给出安装指引并停止。
2. 读取 `$ARGUMENTS` 指向的数据文件（若给的是 project.precis.yaml 则跳到第 4 步），
   按 skill 的 references/v2-format.md 推断结构并生成 V2 配置，落盘位置先向用户确认。
3. 执行 `precis validate --manifest <path> --format json`（Windows 路径含空格加引号）。
4. 按退出码分支用中文汇报：0 通过；1 逐条转述 errors[] 的表/列/行/值/约束；
   2 报工具错误并展示 stderr。最后询问用户修数据还是调规则，迭代至通过。
