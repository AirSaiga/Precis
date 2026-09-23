# WorkBuddy 开放平台适配包

腾讯 WorkBuddy 开放平台（https://open.workbuddy.cn）的上架材料。

## 目录内容

- `precis-data-validation/` — **技能包**（发布管理 → 技能 上传）。
- `precis/` — **连接器包**（发布管理 → 连接器 上传，CLI + Skill 方案）：
  - `connector-meta.json`：元信息，`type: "cli"`，`minWorkbuddyVersion: "5.0.0"`
    （`cli.json` 的 Python 运行时与 `examples_*` 字段要求的最高版本）；
  - `cli.json`：声明托管 Python 运行时（3.12），三平台 init 均为
    `python -m pip install precis-cli`；Precis 无需认证，故无 auth/status/unAuth；
  - `icon.svg`：**占位图标**（简单表格+对勾图形），正式上架前应替换为设计稿；
  - `skills/precis-data-validation/`：技能文件（CLI 方案强烈推荐随包提供）。
- `precis-data-validation.zip` / `precis-connector.zip` — 打好的上传包
  （内容为构建产物，重新打包：`python` 遍历对应目录写 zip，保持包根目录在 zip 顶层）。

## 同步纪律

- 内容单一事实源是 `../skills/precis-data-validation/`（harness 中立）。
  两个适配副本（技能包根目录与连接器包内 `skills/`）只改 frontmatter 与
  references 引用语法（`@references/xxx.md`），正文改动一律先改单一事实源再同步。
- 连接器内嵌的 `skills/precis-data-validation/` 是技能包目录的**直接拷贝**，
  重新打包前确认两者一致（`diff -r`）。
- 规范依据：https://open.workbuddy.cn/docs/skill 与
  https://open.workbuddy.cn/docs/connector
