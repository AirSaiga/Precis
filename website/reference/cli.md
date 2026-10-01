# CLI 参考

Precis CLI 是命令行入口，支持**交互式 Shell** 与**独立命令**两种模式，适合快速校验数据文件、CI/CD 流水线集成、批量处理多个项目。

> 本页为常用命令精简参考。完整文档见仓库 [`docs/cli-reference.md`](https://github.com/AirSaiga/Precis/blob/main/docs/cli-reference.md)。

## 安装与启动

```bash
# PyPI 安装（推荐）
pip install precis-cli

# 或从源码运行
git clone https://github.com/AirSaiga/Precis.git
cd Precis && npm run cli          # 交互式 Shell
npm run cli:validate              # 用内置示例数据快速自检
```

## 交互式 Shell

进入 Shell 后支持命令历史（上下箭头）、Tab 补全与帮助系统：

```
precis> help
precis> open /path/to/project
precis> validate
precis> exit
```

## 命令一览

| 命令 | 别名 | 说明 |
| ---- | ---- | ---- |
| `open` | `o` | 打开项目 |
| `validate` | `check` | 运行校验 |
| `project` | `p` | 项目管理（status / history） |
| `config` | — | 配置管理（8 个子命令） |
| `ai` | `assistant` | AI 助手（chat / ask / generate / migrate） |
| `provider` | — | AI 提供商管理 |
| `help` | `?` | 显示帮助 |
| `pwd` / `ls` | `cwd` / `dir` | 路径与目录 |
| `exit` | — | 退出 Shell |

## 项目管理

### open — 打开项目

```
precis> open                        # 无参数：交互式选择历史项目
precis> open 1                      # 按历史索引打开
precis> open /path/to/my-project    # 按路径打开
```

指定路径时，会验证目录中存在 `project.precis.yaml`；成功后自动加载项目配置与 Schema。历史记录保存在 `~/.precis_project_history`。

### validate — 运行校验

```
precis> validate                                          # 在已打开的项目上下文中运行
precis> validate --manifest /path/to/project.precis.yaml  # 独立模式
precis> validate --table users                            # 仅校验指定表
```

| 参数 | 说明 |
| ---- | ---- |
| `--manifest <path>` | 项目清单文件路径（独立模式必需） |
| `--data-directory <path>` | 数据目录路径（可选，默认用 manifest 中的配置） |
| `--table <name>` | 仅校验指定表（可选，默认校验所有表） |

**输出**：通过显示 ✅ 与统计信息；失败显示 ❌ 与错误明细（行号、列名、违规值、错误类型）。

### project — 项目状态

```
precis> project status     # 当前项目状态
precis> project history    # 项目历史
```

## 配置管理

```
precis> config show                # 显示 project.precis.yaml 内容
precis> config edit                # 在默认编辑器中打开
precis> config list                # 列出所有 YAML 配置文件
precis> config init                # 初始化新项目配置
precis> config get <key>           # 按点分路径取值
precis> config set <key> <value>   # 按点分路径设值
precis> config check               # 校验 YAML 语法
precis> config inspect             # 跨文件引用一致性自检
```

## AI 助手

AI 命令需先配置提供商（`provider` 命令或应用内设置页）：

```
precis> ai chat                                    # 交互式 AI 对话（Agent 模式）
precis> ai ask "给 users.email 加唯一约束"          # 一次性问答
precis> ai generate data/users.xlsx                # 从数据文件预览生成配置
precis> ai generate data/*.xlsx --apply            # 生成并写入项目
precis> ai migrate scripts/legacy.sql data/users.xlsx --apply   # 从旧脚本迁移配置
precis> provider                                   # 交互式管理 AI 提供商
```

## 独立模式与退出码

不进入 Shell 直接执行，适合 CI/CD 流水线：

```bash
precis validate \
  --manifest /path/to/project.precis.yaml \
  --data-directory /path/to/data
```

| 退出码 | 含义 |
| ------ | ---- |
| `0` | 校验通过 |
| `1` | 校验失败或执行错误 |

可直接作为流水线质量门禁使用。
