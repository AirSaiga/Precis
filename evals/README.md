# Precis AI 能力评估集（evals/）

为三类 AI 能力建的可重复运行评估集与成功率基线（毕业计划 G3 项）：

| 套件 | 能力 | 链路真实性 |
|------|------|-----------|
| `generation` | 配置生成（自然语言 + 数据画像 → V2 YAML） | 生产 `build_prompt` → Provider → `parse_llm_response` → `build_config` 全链路，画像数据由任务提供 |
| `migration` | 配置迁移（旧脚本/描述 → V2） | 生产 `ConfigMigrationService.migrate_from_script` 全链路（真实画像 + ScriptParseTool + 分片 + LLM + 合并） |
| `agent` | AI 对话 Agent（工具调用与变更集） | 生产 `ChatAgentRunner` 工具循环 + 两阶段写盘确认（评估自动 confirm）+ frontend_instructions 变更集 |

## 快速开始

```bash
# 1) 干跑（FakeProvider，零密钥零网络）——验证框架与判分逻辑
python evals/run_evals.py --dry-run

# 2) 真实运行（探测 ~/.precis/ai_providers.yaml，或 --provider 指定）
python evals/run_evals.py
python evals/run_evals.py --suite generation --provider deepseek

# 3) 首轮基线归档（真实运行 + 写入 evals/baselines/）
python evals/run_evals.py --archive-baseline
```

Provider 探测优先级：`--provider` 显式指定 > 用户级配置 `defaults.generate` > `defaults.chat` > 首个带可用凭据的 provider。探测不到可用密钥时退出码 2 并提示改用 `--dry-run`。

## 输出

- `evals/results/<时间戳>[-provider].json` — 成功率 JSON（逐任务、逐检查明细）
- `evals/results/<时间戳>[-provider].md` — 人读 Markdown 摘要（按套件/任务类型分组）
- `evals/baselines/baseline-*.json|.md` — 归档基线（只对真实模型运行有效）

退出码：0 全部通过；1 存在失败任务；2 无可用 Provider。

## 任务结构

每个任务 = **输入**（画像数据/旧脚本/用户消息 + 种子项目）+ **期望产物** + **程序化判分脚本**
（`Check` 列表，全部通过才算任务通过）。任务按三类标注：

- `normal` — 常规正确性（如：邮箱列生成正则节点、Range 参数正确）
- `boundary` — 边界场景（宽表列数降级、引用不存在列、乱码输入）
- `adversarial` — 对抗场景（提示词注入、重复创建、越界修改、冲突规则合并）

每套件 12 个任务。判分只看**产物**（build_config 输出 / 磁盘文件 / 变更集信封），不 mock
内部实现。Agent 套件的写盘走生产两阶段确认链路，评估框架经同一 `ConfirmController` 接口
自动 confirm（扮演"同意写盘的用户"），落盘路径与 GUI 生产环境一致。

## 目录

```
evals/
├── run_evals.py            # 一键运行器
├── precis_evals/
│   ├── common.py           # Provider 探测、任务/检查模型、报告输出
│   ├── generation_suite.py # 生成套件（12 任务）
│   ├── migration_suite.py  # 迁移套件（12 任务）
│   └── agent_suite.py      # 对话 Agent 套件（12 任务）
├── results/                # 每次运行输出（不提交）
└── baselines/              # 归档基线（提交留档）
```

## 与 challenges/ 的关系

`challenges/` 评估"编码 agent 做本仓库任务"（种子工作区 + verify 脚本）；本目录评估
"产品内 AI 三链路的能力质量"，仅复用其"输入 + 期望产物 + 程序化判分"思路，内容全新。
