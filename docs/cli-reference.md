# Precis CLI 参考

> **版本**：Pre-Alpha | **最后更新**：2026-06-22

---

## 目录

- [概述](#概述)
- [启动方式](#启动方式)
- [交互式 Shell](#交互式-shell)
- [命令一览](#命令一览)
- [项目管理命令](#项目管理命令)
  - [open](#open)
  - [validate](#validate)
  - [project](#project)
- [配置管理命令](#配置管理命令)
  - [config](#config)
- [AI 助手命令](#ai-助手命令)
  - [ai](#ai)
  - [provider](#provider)
- [系统命令](#系统命令)
- [独立模式](#独立模式)

---

## 概述

Precis CLI 是命令行工具，支持交互式 Shell 和独立命令两种模式。适用于：
- 快速校验数据文件
- CI/CD 流水线集成
- 批量处理多个项目
- 不需要可视化画布的场景

---

## 启动方式

```bash
# 交互式 Shell
npm run cli

# 或直接运行
cd backend && python -B -m app.cli

# 快速验证安装
npm run cli:validate
```

---

## 交互式 Shell

启动后进入交互式 Shell，支持：

- **命令历史**：上下箭头翻阅历史命令
- **Tab 补全**：命令名自动补全
- **帮助系统**：`help` 或 `?` 查看所有命令，`help <命令>` 查看详细帮助

```
precis> help
precis> open /path/to/project
precis> validate
precis> exit
```

---

## 命令一览

| 命令 | 别名 | 说明 |
|------|------|------|
| `open` | `o` | 打开项目 |
| `validate` | `check` | 运行校验 |
| `project` | `p` | 项目管理 |
| `config` | — | 配置管理（8 个子命令） |
| `ai` | `assistant` | AI 助手（8 个子命令） |
| `provider` | — | AI 提供商管理 |
| `help` | `?` | 显示帮助 |
| `pwd` | `cwd` | 显示当前路径 |
| `ls` | `dir` | 列出目录内容 |
| `exit` | — | 退出 Shell |

---

## 项目管理命令

### open

打开一个项目目录，使其成为后续命令的上下文。

```
precis> open                        # 无参数：交互式选择历史项目
precis> open 1                      # 按历史索引打开
precis> open /path/to/my-project    # 按路径打开
```

**行为说明**：
- 无参数时，显示最近打开的项目历史列表，通过编号选择
- 指定路径时，验证目录中存在 `project.precis.yaml`
- 成功打开后，自动加载项目配置和 Schema
- 历史记录保存在 `~/.precis_project_history`

---

### validate

运行数据校验。

```
precis> validate                                      # 在已打开的项目上下文中运行
precis> validate --manifest /path/to/project.precis.yaml  # 独立模式
precis> validate --manifest /path/to/project.precis.yaml --data-directory /path/to/data
precis> validate --manifest /path/to/project.precis.yaml --table users  # 指定表
```

**参数**：

| 参数 | 说明 |
|------|------|
| `--manifest <path>` | 项目清单文件路径（独立模式必需） |
| `--data-directory <path>` | 数据目录路径（可选，默认使用 manifest 中的配置） |
| `--table <name>` | 仅校验指定表（可选，默认校验所有表） |

**输出**：
- 校验通过：显示 ✅ 和统计信息
- 校验失败：显示 ❌、错误明细（行号、列名、违规值、错误类型）

---

### project

项目管理聚合命令。

```
precis> project open              # 等同于 open
precis> project status            # 显示当前项目状态
precis> project st                # 同上（别名）
precis> project history           # 显示项目历史
precis> project h                 # 同上（别名）
```

---

## 配置管理命令

### config

配置管理聚合命令，包含 8 个子命令。

```
precis> config show               # 显示当前配置文件内容
precis> config edit               # 编辑配置文件
precis> config list               # 列出所有配置文件
precis> config init               # 初始化新配置文件
precis> config get <key>          # 获取配置值（按 key 路径）
precis> config set <key> <value>  # 设置配置值
precis> config check              # 检查配置文件语法
precis> config inspect            # 跨文件一致性自检
```

**子命令说明**：

| 子命令 | 说明 |
|--------|------|
| `show` | 显示当前项目的 `project.precis.yaml` 内容 |
| `edit` | 在默认编辑器中打开配置文件 |
| `list` | 列出项目中所有 YAML 配置文件 |
| `init` | 在当前目录初始化新的项目配置 |
| `get` | 按点分路径获取配置值，如 `config get settings.validation.strict_mode` |
| `set` | 按点分路径设置配置值 |
| `check` | 校验所有 YAML 文件的语法正确性 |
| `inspect` | 检查跨文件引用一致性（如 Schema 引用的文件是否存在） |

---

## AI 助手命令

### ai

AI 助手聚合命令。默认启用 Agent 深度模式，AI 会通过 `read_project`、`apply_actions`、`validate_table` 等工具循环完成查-改-验。

```
precis> ai chat                              # 进入交互式 AI 对话（Agent 模式）
precis> ai chat --no-agent-mode              # 关闭 Agent，降级为旧 JSON actions 路径
precis> ai ask "给 users.email 加唯一约束"   # 一次性 AI 问答
precis> ai generate data/users.xlsx          # 从数据文件预览生成配置
precis> ai generate data/*.xlsx --apply      # 生成并写入项目
precis> ai migrate scripts/legacy.sql data/users.xlsx --apply  # 从旧脚本迁移配置
precis> ai status                            # 显示 AI 配置状态
precis> ai switch <provider>                 # 切换默认 AI 提供商
precis> ai provider                          # 管理 AI 提供商（等同于 provider 命令）
precis> ai delete [provider]                 # 删除已配置的提供商
```

**ai chat 参数**：

| 参数 | 说明 |
|------|------|
| `--stream` | 启用流式输出 |
| `--no-stream` | 禁用流式输出（默认） |
| `--no-agent-mode` | 关闭 Agent 深度模式，使用旧 JSON actions 路径 |

**ai generate 参数**：

| 参数 | 说明 |
|------|------|
| `[files...]` | 数据文件路径，支持通配符；缺省扫描项目 `data/` 目录 |
| `--apply` | 将生成的配置写入项目（默认仅预览） |
| `--no-agent-mode` | 使用单次快速生成，不走 Agent 优化 |
| `--max-iterations N` | Agent 最大迭代次数（默认 2，范围 1-5） |
| `--sample-rows N` | 每文件采样行数（默认 100） |
| `--sample-values N` | 每列采样值数量（默认 100） |
| `--generate-regex` | 同时生成正则节点 |

**ai migrate 参数**：

| 参数 | 说明 |
|------|------|
| `<script_file>` | 旧脚本文件路径（.py/.sql/.txt 等） |
| `[data_files...]` | 数据文件路径，支持通配符 |
| `--apply` | 将迁移的配置写入项目（默认仅预览） |
| `--language <lang>` | 脚本类型：python / sql / excel_formula / natural_language |
| `--max-iterations N` | Agent 最大迭代次数（默认 2） |
| `--sample-rows N` | 每文件采样行数（默认 100） |
| `--sample-values N` | 每列采样值数量（默认 100） |

### provider

AI 提供商管理（交互式）。

```
precis> provider                  # 进入交互式提供商管理
precis> provider reload           # 重新加载提供商配置
precis> provider test <id>        # 测试指定提供商连接
```

---

## 系统命令

```
precis> pwd                       # 显示当前工作目录或打开的项目路径
precis> ls                        # 列出项目根目录内容
precis> ls /path/to/dir           # 列出指定目录内容
precis> help                      # 显示所有命令
precis> help open                 # 显示 open 命令详细帮助
precis> exit                      # 退出 Shell
```

---

## 独立模式

不进入交互式 Shell，直接执行命令：

```bash
# 直接运行校验
cd backend && python -B -m app.cli validate \
  --manifest ../my-project/project.precis.yaml \
  --data-directory ../my-project/data

# 仅校验特定表
cd backend && python -B -m app.cli validate \
  --manifest ../my-project/project.precis.yaml \
  --table users
```

独立模式适用于 CI/CD 流水线，退出码：
- `0` — 校验通过
- `1` — 校验失败或执行错误
