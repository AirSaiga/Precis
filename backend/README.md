# Precis 后端 / Precis Backend

> **Alpha** — 核心功能已成型，接口可能调整。

FastAPI + CLI + 核心校验引擎，采用三层分离架构。

完整项目说明请见 [根目录 README.md](../README.md)。

---

## 架构

```
backend/app/
├── api/                    # API 层
│   ├── main.py             # FastAPI 应用入口（路由注册、中间件、CORS）
│   ├── dependencies.py     # 依赖注入
│   ├── middleware/          # 中间件
│   ├── models/             # 请求/响应 Pydantic 模型
│   ├── routers/            # 路由定义
│   │   ├── core/           # 核心路由（项目、工作区）
│   │   ├── project/        # V2 项目 CRUD（Schema、Constraint、Regex、Transform）
│   │   ├── validation/     # 校验执行与历史
│   │   ├── preview/        # 数据预览
│   │   └── ai/             # AI 配置生成
│   └── services/           # API 层服务
├── cli/                    # 交互式命令行（shell 模式）
│   └── shell/              # REPL 实现
├── shared/                 # 三层分离架构
│   ├── core/               # 框架级基础设施
│   │                       # 文件 I/O、配置解析（YAML）、数据加载
│   ├── domain/             # 纯业务领域逻辑（无 I/O 依赖）
│   │   ├── constraints/    # 10 种约束类型定义
│   │   │   ├── not_null.py, unique.py, foreign_key.py
│   │   │   ├── allowed_values.py, range.py, conditional.py
│   │   │   ├── scripted.py, charset.py, date_logic.py
│   │   │   ├── composite.py, regex.py
│   │   │   └── base.py, condition_registry.py
│   │   ├── transforms/     # 22 种转换类型定义
│   │   │   ├── string_split.py, regex_extract.py, math_expr.py
│   │   │   ├── date_format.py, conditional_assign.py, map_value.py
│   │   │   ├── lookup.py, filter_rows.py, sort_rows.py, aggregate.py
│   │   │   ├── cast_type.py, concat.py, digits.py, drop_duplicates.py
│   │   │   ├── fill_na.py, lower_case.py, upper_case.py, modulo.py
│   │   │   ├── replace.py, strip.py, substring.py, weighted_sum.py
│   │   │   └── base.py, registry.py
│   │   ├── data_types.py   # 数据类型定义（string/integer/float/decimal/boolean/date）
│   │   ├── dataset_schema.py # Schema 模型
│   │   ├── expression_system.py # 表达式求值系统
│   │   └── schema/         # Schema 相关领域逻辑
│   └── services/           # 应用服务（编排 core 和 domain）
│       ├── validation/     # 校验引擎（两阶段流水线）
│       │   ├── executor.py # ValidationExecutor 主编排器
│       │   ├── engine.py   # 校验执行引擎
│       │   ├── data_loader.py # 数据加载
│       │   ├── loader.py   # 配置加载
│       │   ├── resolver.py # 数据源解析
│       │   ├── extractors.py # 派生列提取（regex）
│       │   ├── history.py  # 校验历史持久化
│       │   ├── dag/        # 转换 DAG 执行
│       │   ├── validators/ # 各类型校验器（每种约束一个文件）
│       │   └── types.py    # 校验类型定义
│       ├── ai/             # AI 服务
│       ├── llm/            # LLM 集成（OpenAI / Ollama）
│       ├── preview/        # 数据预览服务
│       ├── diff/           # 配置差异比较
│       └── hardware.py     # 硬件检测
└── start_server.py         # 服务器启动入口
```

### 关键约定

- `domain/` 不得导入 `core/` 或 `services/`，保持纯净
- API 路由在 `api/routers/`，请求/响应模型在 `api/models/`
- 路由注册入口：`api/main.py`
- 所有请求通过 `X-Project-Config-Path` header 标识当前项目

---

## 校验引擎（两阶段流水线）

```
阶段 1: 数据加载与预处理
  ├── DataSourceResolver → 解析文件路径
  ├── DataLoader → 加载 Excel/CSV/JSON
  ├── process_dataframe → 类型转换、格式检查
  ├── extractors → 派生列提取（regex）
  └── Transform DAG → 拓扑排序执行 transform 链

阶段 2: 约束校验
  └── 逐约束调用 validate()，聚合错误
        （validators/ 下每种类型一个：not_null.py, unique.py, foreign_key.py ...）
```

---

## 开发命令

```bash
# 安装
python -m venv .venv
pip install -e ".[dev]"

# 运行
python -m uvicorn app.api.main:app --reload --port 18000

# 代码检查
python -m ruff check .              # lint（不自动修复）
python -m ruff check --fix .        # lint 自动修复
python -m ruff format .             # 格式化
python -m mypy .                    # 类型检查

# 测试
python -m pytest                    # 运行全部测试

# CLI
python -B -m app.cli
```

---

## 配置文件格式（V2 YAML）

| 文件类型 | 命名 | 说明 |
|---------|------|------|
| 项目清单 | `project.precis.yaml` | 索引所有 Schema/Constraint/Regex/Transform 资源 |
| Schema | `*.schema.yaml` | 表结构定义（列、数据类型、内嵌约束） |
| Constraint | `*.constraint.yaml` | 独立约束（refs + params 分离设计） |
| Regex | `*.regex.yaml` | 正则节点（引用模式或直接模式） |
