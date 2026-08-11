# R02 参考答案 — 新增 CLI `version` 命令

## 核心难点（为什么这题是 ★★☆）

CLI 框架是**自行实现**的交互式 Shell（不是 click/argparse），命令接入需要摸清三处分散的
接通点，遗漏任何一处都会导致测试失败：

1. **命令类实现**（继承 `Command` 抽象基类，实现 `description` 属性 + `execute` 方法）
2. **命令集合包的导出**（`commands/__init__.py` 的 import + `__all__`）
3. **Shell 启动时的注册调用**（`main.py` 的 `_setup_commands()` 里逐条 `register`）

> 关键陷阱：**注册不是自动的**。仅写一个继承 `Command` 的类、甚至在 `__init__.py` 导出它，
> 都不会让命令变得可调用——`CommandRegistry` 是在 `CLIShell._setup_commands()` 里**逐条手动
> `register`** 的。漏掉第 3 步，`shell.registry.get("version")` 会返回 `None`，
> `CommandParser.parse("version")` 会抛 `CommandNotFoundError`。

> 版本号来源陷阱：**不要硬编码** "0.1.0"。仓库里已有读取包元数据的标准方式
> （`importlib.metadata.version("precis")` 带 fallback，见 `app/api/main.py` 的 `/api/latest/version`
> 端点）。命令应复用同一套读取方式，这样版本升级时无需改命令代码。

## Command 契约（抽象基类 `base.py`）

`Command(ABC)` 规定的契约：

| 成员 | 类型 | 要求 |
|------|------|------|
| `__init__(self)` | 构造器 | 调 `super().__init__("name", aliases=[...])` 设置 `name`/`aliases` |
| `description` | `@property` (abstract) | 子类**必须**实现，返回非空描述字符串 |
| `usage` | `@property` | 可选覆盖，默认返回 `self.name` |
| `help_text` | `@property` | 自动生成（基类已实现，依赖 usage/description/aliases） |
| `execute(args, context)` | 方法 (abstract) | 子类**必须**实现，返回 `CommandResult` |

`execute` 的签名是 `execute(self, args: list[str], context: ProjectContext) -> CommandResult`。
返回 `CommandResult.ok(message, data=...)` / `.error(...)` / `.exit(...)`。

## 需要改动的 3 个文件

### 1. 新建 `backend/app/cli/shell/commands/version.py`

```python
from app.cli.shell.commands.base import Command, CommandResult, ProjectContext


def _get_version() -> str:
    """读取当前 Precis 包的版本号。

    从已安装的包元数据中读取，读取失败时回退到 "1.0.0"
    （与 Web 模式 /api/latest/version 端点的回退策略保持一致）。
    """
    from importlib.metadata import version

    try:
        return version("precis")
    except Exception:
        return "1.0.0"


class VersionCommand(Command):
    """版本命令。打印当前 Precis 的版本号，只读，不触发退出。"""

    def __init__(self):
        super().__init__("version")

    @property
    def description(self) -> str:
        return "显示 Precis 版本号"

    @property
    def usage(self) -> str:
        return "version"

    def execute(self, args: list[str], context: ProjectContext) -> CommandResult:
        ver = _get_version()
        return CommandResult.ok(f"Precis {ver}", data={"version": ver})
```

要点：
- `super().__init__("version")` 设置命令名（**必须**是 `"version"`，测试断言 `cmd.name == "version"`）。
- 不传 `aliases`（题目未要求别名，`aliases` 默认 `[]`，是合法的 list）。
- `execute` 返回 `CommandResult.ok(...)`，`success=True`、`should_exit=False`。
- 版本号通过 `importlib.metadata.version("precis")` 读取，包名 `precis` 见 `backend/pyproject.toml` 的 `name = "precis"`。

### 2. `backend/app/cli/shell/commands/__init__.py`

加一行 import 并把 `VersionCommand` 加入 `__all__`：

```python
from app.cli.shell.commands.version import VersionCommand

__all__ = [
    ...,
    "LsCommand",
    "VersionCommand",   # 新增
]
```

> 这一步让 `from app.cli.shell.commands import VersionCommand` 可用。测试中有这条导入，
> 漏掉会在收集期 `ImportError`。

### 3. `backend/app/cli/shell/main.py`

两处：

(a) 顶部 import 块加入 `VersionCommand`：

```python
from app.cli.shell.commands import (
    ...,
    ValidateCommand,
    VersionCommand,   # 新增
)
```

(b) `CLIShell._setup_commands()` 里注册（位置无关，与其它 `register` 并列即可）：

```python
def _setup_commands(self) -> None:
    self.registry.register(HelpCommand(self.registry))
    ...
    self.registry.register(LsCommand())
    self.registry.register(VersionCommand())   # 新增
    self.registry.register(ExitCommand())
```

> **这是关键的一步**：`CommandRegistry` 是手动填充的，不在 `__init__.py` 里、也没有装饰器
> 自动注册。`register(VersionCommand())` 把命令以 `name="version"` 写入 `_commands` 字典。
> 漏掉这一步，命令类存在、包也导出了，但 `shell.registry.get("version")` 仍是 `None`。

## 验证记录

- 参考方案就位：`python verify.py` → **PASS**（exit 0），18/18 测试通过。
  覆盖：Command 契约（继承/name/aliases/description/usage/help_text）、
  注册（`registry.list_commands()` 含 version、`registry.get("version")` 命中、
  `CommandParser.parse("version")` 解析成功、`CommandExecutor.execute("version")` 成功）、
  执行（返回 `CommandResult`、`success=True`、message 非空、**含真实版本号**、不触发退出、
  宽容多余参数）。
- 回退方案（clean repo）：`python verify.py` → **FAIL**（exit 1），
  `ImportError: cannot import name 'VersionCommand' from 'app.cli.shell.commands'`。
- 全 CLI 回归：`pytest tests/unit/cli/ tests/integration/test_cli_smoke.py tests/integration/test_cli_regression.py`
  → 120 passed, 0 failed（参考方案不破坏任何既有 CLI 测试）。
- 端到端：`python -m app.cli version` → 打印 `Precis 0.1.0`，退出码 0。

## 备选实现（同样通过）

- 别名：可加 `aliases=["v", "ver"]`，测试不断言具体别名集合，仅检查 `isinstance(aliases, list)`。
- 版本格式：`message` 可改为 `f"版本: {ver}"` 或纯 `ver`，测试只断言**真实版本号子串**出现
  （`expected in result.message`），不锁死前缀文案。
- `description` 可写任意非空中文/英文，测试只检查非空。
- 多余参数处理：可解析 `--short` 等自定义 flag，测试只要求不崩溃且仍返回版本号。
