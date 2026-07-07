# Precis TUI

Precis 的终端界面（TUI），基于 [Textual](https://textual.textualize.io/) 构建。

## 与 CLI 的关系

TUI 与现有 CLI（`app/cli/shell/`）是**并列的第二套交互界面**，两者共享同一套核心业务逻辑：

- `app/shared/**`：核心业务（API/CLI/TUI 三端共享，不重复实现）
- `app/cli/shared_services/**`：CLI/TUI 共享薄壳（P0b 抽出，收敛"改两处"隐患）
- `app/cli/shell/**`：CLI 交互层（REPL，`precis` 命令）
- `app/cli/tui/**`：TUI 交互层（本目录，`precis-tui` 命令）

**原则**：TUI 只负责显示与输入，所有非 UI 业务规则都走 `shared_services` 或更核心的 `app.shared`。新增功能时遵循 `docs/TUI_PARALLEL_TASK_PACKAGES.md` 的三层架构准则。

## 目录结构

| 路径 | 职责 | 所属任务包 |
|------|------|-----------|
| `app.py` | 主应用 `PrecisTUIApp` 与启动入口 | P0a 骨架 / P6 完善 |
| `protocols.py` | service 层共享协议（`ProjectState`、`register_screen`） | P0a（冻结接口） |
| `screens/` | 各功能屏（校验、Provider、配置、对话、生成） | P1-P5 各自独占 |
| `widgets/` | 可复用组件（历史列表、命令面板、状态条） | P1-P6 |
| `services/` | service 层（薄包装，调 shared_services） | P1-P5 |
| `styles/app.tcss` | Textual 样式表 | P0a 基础 / P6 打磨 |

## 运行

```bash
cd backend
python -m app.cli.tui        # 直接运行
precis-tui                   # 通过 console_script（pip install -e . 后可用）
```

## 关键约定

- **接口冻结**：`protocols.py` 中的 `ProjectState` 与 `register_screen` 是 P1-P5 必须遵守的契约。发现不足时不得修改本公共文件，在自己的 service 内扩展，由 P6 统一回填。
- **零 CLI 回归**：新增 TUI 不改动 `app/cli/shell/` 的任何外部行为。

详见 `docs/TUI_PARALLEL_TASK_PACKAGES.md`。
