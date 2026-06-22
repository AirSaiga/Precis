# Precis 用户指南

> **版本**：Pre-Alpha | **最后更新**：2026-06-22

---

## 目录

- [简介](#简介)
- [安装](#安装)
  - [前置条件](#前置条件)
  - [快速安装](#快速安装)
  - [手动安装](#手动安装)
- [启动方式](#启动方式)
  - [Electron 桌面版（推荐）](#electron-桌面版推荐)
  - [Web 开发模式](#web-开发模式)
  - [CLI 命令行](#cli-命令行)
- [核心概念](#核心概念)
  - [项目（Project）](#项目project)
  - [Schema（表结构）](#schema表结构)
  - [Constraint（约束）](#constraint约束)
  - [Transform（转换）](#transform转换)
  - [Template（模板）](#template模板)
  - [Regex（正则）](#regex正则)
  - [DAG 画布](#dag-画布)
- [快速上手](#快速上手)
  - [创建项目](#创建项目)
  - [导入数据源](#导入数据源)
  - [定义 Schema](#定义-schema)
  - [添加约束](#添加约束)
  - [运行校验](#运行校验)
  - [查看结果](#查看结果)
- [三端模式对比](#三端模式对比)

---

## 简介

Precis 是一款**本地优先**的可视化数据质量平台，面向 Excel/CSV/JSON 表格数据。通过拖拽式 DAG 画布，将数据校验流程从代码转化为可视化操作——非技术人员亦可完成从数据源接入到多维度质量校验的完整链路。

**三种入口**：
- **Electron 桌面应用**（推荐）— 一体化体验，自动管理后端进程
- **CLI 命令行** — 适合 CI/CD 集成和批量校验
- **REST API** — 适合自定义集成（Swagger UI: `http://127.0.0.1:18000/docs`）

---

## 安装

### 前置条件

| 工具 | 版本要求 | 说明 |
|------|---------|------|
| **Node.js** | `^20.19.0` 或 `>=22.12.0` | [下载](https://nodejs.org/) |
| **Python** | `>=3.12, <3.14` | [下载](https://python.org/) |
| **Git** | 任意版本 | [下载](https://git-scm.com/) |

### 快速安装

```bash
git clone https://github.com/AirSaiga/Precis.git
cd Precis

# Windows 一键安装
npm run setup:win

# macOS / Linux 一键安装
npm run setup:mac
```

一键安装脚本会自动完成：前端依赖、Electron 依赖、Python 虚拟环境创建、后端依赖安装、`.env` 文件生成。

### 手动安装

```bash
git clone https://github.com/AirSaiga/Precis.git
cd Precis

# 1. 前端 + Electron 依赖
npm run install:all

# 2. 后端 Python 环境
cd backend
python -m venv .venv
# Windows:
.venv\Scripts\activate
# macOS/Linux:
source .venv/bin/activate

pip install -e ".[dev]"
cd ..

# 3. 环境变量
cp .env.example .env
```

---

## 启动方式

### Electron 桌面版（推荐）

```bash
npm run electron:dev
```

自动管理后端进程，无需手动启动 Python 服务。桌面版提供完整的文件系统访问、对话框、自动更新等能力。

### Web 开发模式

```bash
npm run dev
```

同时启动：
- 后端 FastAPI 服务（端口 18000）
- 前端 Vite 开发服务器（端口 5173）

浏览器访问 `http://localhost:5173`，Swagger UI 访问 `http://127.0.0.1:18000/docs`。

### CLI 命令行

```bash
npm run cli              # 交互式 Shell
npm run cli:validate     # 快速验证安装是否正常
```

CLI 详细用法见 [CLI 参考文档](cli-reference.md)。

---

## 核心概念

### 项目（Project）

一个 Precis 项目对应一个目录，包含：
- `project.precis.yaml` — 项目清单（入口文件）
- `schemas/` — 表结构定义
- `constraints/` — 独立约束规则
- `transforms/` — 数据转换
- `templates/` — 约束/转换模板
- `regex/` — 正则节点
- `patterns/` — 可复用正则模式
- `data/` — 数据文件（CSV / Excel / JSON）

### Schema（表结构）

描述一张表的列定义（列名、数据类型、是否主键、是否可空）和数据源位置。每个 Schema 对应一个 `.schema.yaml` 文件。

**支持的数据类型**：`string`、`integer`、`float`、`decimal`、`boolean`、`date`

**支持的数据格式**：CSV、Excel（`.xlsx`/`.xls`）、JSON

### Constraint（约束）

对数据列施加的校验规则。共 10 种：

| 约束类型 | 说明 |
|---------|------|
| **NotNull** | 列值不允许为空 |
| **Unique** | 列值唯一（支持复合唯一） |
| **ForeignKey** | 外键引用完整性 |
| **AllowedValues** | 值必须在允许列表内 |
| **Range** | 数值范围校验 |
| **Conditional** | 条件触发校验（如果 A 列满足某条件，则 B 列必须满足另一条件） |
| **Scripted** | 自定义 Python 表达式校验 |
| **Charset** | 字符集校验（ASCII / 中文 / 中英混合） |
| **DateLogic** | 日期逻辑校验（日期比较、年龄计算、天数差） |
| **Composite** | 组合约束（多个子约束的逻辑聚合） |

约束可以**内嵌**在 Schema 文件中，也可以作为**独立文件**引用。

### Transform（转换）

对数据列进行转换处理。共 22 种算子，包括：

| 分类 | 算子 |
|------|------|
| **字符串** | StringSplit、Substring、UpperCase、LowerCase、Strip、Replace、Concat |
| **正则** | RegexExtract |
| **数值** | MathExpr、Modulo、WeightedSum、Digits |
| **日期** | DateFormat |
| **类型** | CastType、FillNA |
| **映射** | Lookup、MapValue、ConditionalAssign |
| **行操作** | FilterRows、DropDuplicates、SortRows、Aggregate |

转换可以串联成 DAG，按拓扑顺序执行。

### Template（模板）

模板是可复用的约束/转换组合，支持参数化。通过 `{{param}}` 占位符定义参数，在实例化时传入具体值。

例如，定义一个"年龄检查"模板，参数化 `min_age` 和 `max_age`，可以在多个 Schema 上复用。

### Regex（正则）

正则节点用于对列值执行正则表达式匹配或提取。支持三种模式：
- `full` — 全文匹配
- `partial` — 部分匹配
- `extract` — 提取命名捕获组

### DAG 画布

所有节点（Schema、Constraint、Transform、Regex、Template）在画布上通过连线组成有向无环图（DAG）。数据沿边流动：数据源 → Schema → Constraint/Transform → 校验结果。

---

## 快速上手

### 创建项目

1. 启动 Electron 桌面版（`npm run electron:dev`）
2. 点击"新建项目"，选择项目目录
3. 系统自动生成 `project.precis.yaml` 清单文件

或者手动创建项目目录结构：

```
my-project/
├── project.precis.yaml
├── schemas/
├── constraints/
├── transforms/
├── templates/
├── regex/
├── patterns/
└── data/
```

### 导入数据源

将 CSV / Excel / JSON 数据文件放入 `data/` 目录。

在 Web/Electron 中，从左侧资源树拖拽数据文件到画布，系统自动创建数据预览节点。

### 定义 Schema

在画布上创建 Schema 节点，或手动编写 `schemas/*.schema.yaml`：

```yaml
version: 2
id: users
name: 用户表
source:
  mode: relative_file
  path: data/users.csv
columns:
  - {id: id, name: id, type: integer, primary_key: true, nullable: false}
  - {id: name, name: name, type: string}
  - {id: email, name: email, type: string, nullable: false}
  - {id: age, name: age, type: integer}
```

### 添加约束

**方式一：内嵌约束**（直接写在 Schema 中）

```yaml
constraints:
  - id: email_unique
    type: Unique
    column: email
  - id: age_range
    type: Range
    column: age
    params: {min: 0, max: 150, boundary_mode: inclusive}
```

**方式二：独立约束文件**（`constraints/*.constraint.yaml`）

```yaml
version: 2
id: orders_fk
type: ForeignKey
enabled: true
refs:
  from_table_id: orders
  from_column_id: customer_id
  to_table_id: customers
  to_column_id: id
```

在画布上，从约束节点连线到 Schema 节点的对应列 Handle 即可建立关联。

### 运行校验

- **自动校验**：默认开启，连线或修改配置后自动触发
- **手动校验**：点击工具栏"校验"按钮
- **CLI 校验**：`npm run cli` → `open <项目目录>` → `validate`

### 查看结果

校验结果在画布上以节点状态颜色标识：
- ✅ 通过（绿色）
- ❌ 失败（红色），点击查看错误详情

错误信息包含：行号、列名、违规值、错误类型。

---

## 三端模式对比

| 能力 | Electron 桌面版 | Web 开发模式 | CLI |
|------|----------------|-------------|-----|
| 可视化 DAG 画布 | ✅ | ✅ | ❌ |
| 文件系统访问 | ✅（原生） | ❌（需手动指定路径） | ✅ |
| 自动更新 | ✅ | ❌ | ❌ |
| 对话框选择文件 | ✅ | ❌ | ❌ |
| CI/CD 集成 | ❌ | ❌ | ✅ |
| 批量校验 | ✅ | ✅ | ✅ |
| REST API | ✅ | ✅ | ❌（纯 CLI） |

---

## 相关文档

- [配置参考](configuration-reference.md) — V2 YAML 格式详解
- [CLI 参考](cli-reference.md) — 命令行工具完整参考
- [AGENTS.md](../AGENTS.md) — 开发架构与规范
