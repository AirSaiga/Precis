# Precis - AI Agent 开发指南 / AI Agent Development Guide

> ⚠️ **项目状态声明（必读）**
>
> Precis 目前处于**超早期原型阶段（Prototype / Pre-Alpha）**。
> - 核心功能框架刚搭成，**测试覆盖严重不足**，已知存在大量 Bug
> - 代码随时可能大规模重构，接口和行为均不保证稳定
> - 本仓库开源仅为展示方向、收集需求反馈，**暂不接受外部代码贡献（Pull Request），但欢迎提交 Issue**
>
> AI Agent 在修改代码时应当格外谨慎：优先做最小改动，避免大规模重构，并理解当前很多"规范"可能只是临时约定。

本文档为 AI Agent 提供 Precis Community 项目的开发指南，包含项目功能概述、编码风格、配置文件规范和数据校验标准。

---

## 1. 项目概述 / Project Overview

### 1.1 主要功能 / Main Features

Precis 是一个面向数据文件（Excel/CSV 等）的可配置校验工具，提供以下核心功能：

| 功能模块 | 说明 |
|---------|------|
| **可视化编排** | 在画布中配置数据源、Schema、约束与正则能力（使用 Vue Flow） |
| **多入口使用** | Electron（桌面）、CLI（批量校验/转换）、API（/docs） |
| **V2 项目清单驱动** | 用单一入口文件索引 Schema / Constraint / Regex 等资源 |
| **数据校验引擎** | 支持唯一性、非空、外键、条件、正则等多种约束类型 |
| **AI 配置生成** | 后端包含 LLM 配置生成服务接口 |
| **国际化支持** | 内置 zh-CN / en-US 支持 |

### 1.2 技术栈 / Tech Stack

| 层级 | 技术 |
|------|------|
| 前端 | Vue 3 + TypeScript + Vite + Pinia + Vue Router + Vue I18n + Vue Flow |
| 后端 | Python + FastAPI + Uvicorn + Pydantic + Pandas |
| 桌面端 | Electron Forge + TypeScript |

### 1.3 项目结构 / Project Structure

```
Precis/
├── backend/           # FastAPI 后端 + CLI + V2 配置引擎
│   ├── app/
│   │   ├── api/       # API 路由和入口
│   │   ├── cli/       # 命令行接口
│   │   ├── core/      # 核心校验引擎
│   │   ├── services/  # 业务服务（含 LLM）
│   │   └── shared/    # 共享核心模块
│   ├── pyproject.toml
│   └── requirements.txt
├── frontend/          # Vue3 可视化编辑器
│   ├── src/
│   │   ├── components/    # 共享 UI 组件（画布、布局、节点、设置等）
│   │   ├── features/      # 垂直切片功能模块（见 1.4 节）
│   │   ├── stores/        # Pinia 状态管理
│   │   ├── types/         # TypeScript 类型定义（非 feature 专属的共享类型）
│   │   ├── composables/   # 组合式函数（非 feature 专属的共享逻辑）
│   │   ├── core/          # 框架级基础设施（logger、api client、toast 等）
│   │   ├── services/      # 服务层（构建器、导出等）
│   │   ├── api/           # 后端 API 调用层
│   │   └── i18n/          # 国际化
│   └── package.json
├── electron/          # Electron 桌面壳
└── docs/              # 项目文档
```

### 1.4 前端 `features/` 目录规范 / Frontend `features/` Directory Standard

`features/` 是**垂直切片功能模块**的归宿，每个 feature 是一个独立的、跨层的业务功能单元。

#### 适合放入 `features/` 的条件 / Criteria for `features/`

满足以下全部条件的功能应组织为 feature：
- **跨层**：涉及 components + composables + types 等多个架构层
- **独立**：功能内聚，有明确的业务边界
- **用户可感知**：面向用户的交互功能（而非底层工具）

#### 每个 feature 的标准结构 / Standard Feature Structure

```
features/<feature-name>/
├── components/     # 该功能的 UI 组件
├── composables/    # 该功能的组合式函数
├── types/          # 该功能的类型定义
├── services/       # 该功能的服务层（可选）
├── stores/         # 该功能的状态管理（可选）
└── index.ts        # 统一导出入口（必须）
```

#### 不适合放入 `features/` 的内容 / What Not to Put in `features/`

| 内容 | 归属目录 | 理由 |
|------|---------|------|
| 框架级基础设施 | `core/` | 无业务语义，被全局使用 |
| 共享 UI 组件 | `components/ui/`, `components/shared/` | 无专属功能域 |
| 全局画布状态 | `stores/graphStore/` | God Store，被所有节点共享 |
| 共享组合式函数 | `composables/` | 无专属功能域 |
| 国际化文件 | `i18n/` | 统一管理 |
| 非专属类型 | `types/` | 被多模块共享的类型 |

#### 已有 Feature 模块 / Existing Feature Modules

| Feature | 说明 | 完整度 |
|---------|------|--------|
| `keyboard/` | 键盘快捷键系统（命令模式） | ✅ 完整 |
| `regex/` | 正则表达式设计器 | ✅ 完整 |
| `node-layout-organizer/` | 节点布局自动整理 | ✅ 完整 |

---

## 2. 编码风格 / Coding Style

### 2.1 Python 后端编码规范 / Python Backend Coding Standards

#### 文件头文档规范 / File Header Documentation Standard
每个 Python 文件必须包含详细的文件头文档，使用多行字符串格式：

```python
"""
@fileoverview 模块名称和功能概述

功能概述:
- 功能点 1
- 功能点 2

架构设计:
- 设计模式说明
- 模块间关系

输入示例:
    示例代码或数据

输出示例:
    示例代码或数据
"""
```

#### 导入规范 / Import Standards
```python
# 1. 标准库导入
from __future__ import annotations
import sys
import os
from typing import Dict, List, Optional

# 2. 第三方库导入
from pydantic import BaseModel, Field, field_validator, model_validator
from fastapi import FastAPI

# 3. 项目内部导入
from app.shared.core.project.manifest.types_parts.constants import V2_VERSION
from app.shared.core.project.manifest.types_parts.info import ProjectInfo
```

#### 类型注解规范 / Type Annotation Standards
- 必须使用类型注解
- 使用 `from __future__ import annotations` 支持延迟注解
- Pydantic 模型用于配置和数据验证

```python
from pydantic import BaseModel, Field

class ProjectManifest(BaseModel):
    """项目清单主类型
    
    字段说明:
        - version: 配置版本号，当前固定为 2
        - project: 项目基本信息
    
    数据校验:
        - ID 唯一性: 自动检测重复 ID
    """
    version: int = Field(V2_VERSION, description="配置版本号（固定为 2）")
    project: ProjectInfo
    settings: ProjectSettings = Field(default_factory=ProjectSettings)
    schemas: List[SchemaRef] = Field(default_factory=list)
```

#### 命名规范 / Naming Conventions
| 类型 | 规范 | 示例 |
|------|------|------|
| 类名 | PascalCase | `ProjectManifest`, `ValidationSettings` |
| 函数/方法 | snake_case | `validate_config()`, `load_manifest()` |
| 常量 | UPPER_SNAKE_CASE | `V2_VERSION`, `DEFAULT_ENCODING` |
| 私有方法/变量 | 前缀下划线 | `_validate_unique_ids`, `_config_path` |
| 模块名 | snake_case | `manifest_loader.py`, `types_parts/` |

#### 注释规范 / Comment Standards
- 使用中文注释
- 复杂逻辑必须添加行内注释
- 使用 `# ========` 分隔大段代码

```python
# ============================================================================
# 路径配置（必须最先执行！）
# ============================================================================

# 添加项目根目录到 Python 导入路径
# __file__ = D:\Project\backend\app\api\main.py
# main.py → api → app → backend → Project
_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
```

### 2.2 TypeScript/Vue 前端编码规范 / TypeScript/Vue Frontend Coding Standards

#### 文件结构规范 / File Structure Standards
```vue
<template>
  <!-- 模板代码 -->
</template>

<script setup lang="ts">
// 1. 导入外部组件
import ComponentA from '@/components/ComponentA.vue'

// 2. 导入类型
import type { MyType } from '@/types'

// 3. 导入组合式函数/工具
import { useStore } from '@/stores/store'
import { ref, computed } from 'vue'

// 代码逻辑
</script>

<style scoped>
/* 样式代码 */
</style>
```

#### 命名规范 / Naming Conventions
| 类型 | 规范 | 示例 |
|------|------|------|
| 组件名 | PascalCase | `NodeCanvas.vue`, `AssetLibrary` |
| 组合式函数 | camelCase，前缀 use | `useGraphStore`, `useTheme` |
| 类型/接口 | PascalCase | `RegexNodeData`, `ConstraintType` |
| 常量 | UPPER_SNAKE_CASE | `AI_CHAT_DRAWER_WIDTH`, `MIN_SIDEBAR_WIDTH` |
| 变量/函数 | camelCase | `sidebarWidth`, `toggleSidebar()` |
| Store | camelCase，后缀 Store | `useCanvasStore`, `useProjectStore` |

#### 类型定义规范 / Type Definition Standards
类型定义放在 `src/types/` 目录：

```typescript
// types/graph.ts
export interface RegexNodeData {
  id: string
  name: string
  pattern: string
  matchMode: 'full' | 'partial' | 'extract'
  caseSensitive: boolean
  sourceRef?: {
    tableId: string
    columnId: string
  }
}

// 联合类型
export type ConstraintType = 
  | 'Unique' 
  | 'NotNull' 
  | 'AllowedValues' 
  | 'ForeignKey' 
  | 'Conditional' 
  | 'Scripted'
```

#### Vue 组件规范 / Vue Component Standards
- 使用 `<script setup lang="ts">` 语法
- 使用 Composition API
- Props 必须定义类型
- 事件使用 camelCase 命名

```vue
<script setup lang="ts">
interface Props {
  visible: boolean
  ruleData?: RegexNodeData
}

const props = defineProps<Props>()

const emit = defineEmits<{
  close: []
  save: [data: RegexNodeData]
}>()

// 组合式函数调用
const graphStore = useGraphStore()
const { t } = useI18n()
</script>
```

#### 画布连接规则规范 / Canvas Connection Rule Standards

前端画布中，**任何会进入 `store.edges` / `graphStore.createConnection()` / `addEdges()` 的连接，都必须先有对应的连接规则定义**。这一条适用于：
- 用户手工拖拽建立的连接
- 节点保存后自动生成的连接
- 导入/回放时恢复的连接
- 仅用于展示但仍然保存在 `edges` 中的连接

必须遵循以下规则：

1. **先定义规则，再创建边**
   - 在 `frontend/src/services/rules/connectionRules.ts` 中补充 source/target nodeTypes 与 handle 约束
   - 若新增了节点类型或连接端点语义，同时检查 `connectionRuleTypes.ts`、`useConnectionValidator.ts`、`connectionPolicyService.ts` 是否需要同步更新

2. **规则粒度必须精确到 handle**
   - 如果连接依赖特定端口，必须显式声明 `source.handles` / `target.handles`
   - 不允许为了“先跑通”而用过宽规则放开整个节点类型
   - 例如：`transform-output -> transformOutput.target-left` 应单独建规则，而不是笼统放开 `transform -> transformOutput`

3. **自动连线与手工连线使用同一套校验前提**
   - 自动创建的边不会天然绕过校验；只要边进入 `edges`，后续就可能被 `ConnectionValidator`、`connectionPolicyService` 或 sanitize 流程判定
   - 因此“代码里能 createConnection 成功”不等于“画布最终会显示”

4. **展示边要么纳入规则，要么明确标记为临时边**
   - 如果展示边会长期存在于 `store.edges`，必须补规则
   - 如果只是短时过渡效果，不应依赖持久化规则；应明确按临时边处理，并确保不会被常规连接校验误杀

5. **新增连接能力时的最小检查清单**
   - 能否在 `connectionRules.ts` 找到唯一对应规则
   - `useConnectionValidator` 日志是否显示 `Matched rule` 而不是 `Reject: no matching rule`
   - 目标 handle 是否与节点组件里的真实 handle id 一致
   - 自动生成/导入恢复后，边是否仍能稳定显示，而不是创建后立即被过滤

常见风险：
- 节点组件里新增了 handle，但忘记补 `connectionRules.ts`
- 自动建边使用了特定 `sourceHandle` / `targetHandle`，规则却仍写成 `undefined`
- 展示边存进了 `edges`，但被当作非法连接在后续 watcher / sanitize 流程中清掉
- 只验证了 `createConnection()` 返回成功，没有检查连接校验日志

结论：**在 Precis 中，“新增一种边”本质上是“新增一种连接语义”**。只要连接语义变了，就必须同步补规则，而不是只改建边代码。

#### CSS 变量规范 / CSS Variable Standards
使用 CSS 变量统一管理主题：

```css
/* 背景色 */
--ui-bg-nav-primary: #1e1e1e;
--ui-bg-sidebar: #252526;
--ui-bg-canvas: #1e1e1e;
--ui-bg-elevated: #2d2d30;

/* 边框 */
--ui-border-subtle: #333;
--ui-border-light: #3c3c3c;

/* 文字 */
--ui-text-primary: #cccccc;
--ui-text-secondary: #9cdcfe;
--ui-text-muted: #858585;

/* 强调色 */
--ui-accent: #007acc;
--ui-accent-primary: #0e639c;
```

---

## 3. 配置文件规范 / Configuration File Standards

### 3.1 项目清单文件 (project.precis.yaml) / Project Manifest File

项目清单是 V2 配置的入口文件，必须遵循以下规范：

```yaml
# ============================================================
# Precis 项目清单文件
# ============================================================

# 配置版本号，固定为 2
version: 2

# 项目基本信息
project:
  id: my-data-project           # 项目唯一标识符（必填）
  name: My Data Project         # 项目展示名称（必填）

# 项目设置（可选，有默认值）
settings:
  validation:                   # 校验行为设置
    auto_validate: true         # 配置变更时自动执行校验
    strict_mode: false          # 非严格模式
    error_handling: continue    # 错误处理策略：continue/report/stop
    timeout_seconds: 30         # 单次校验超时时间（秒）
    batch_max_files: 100        # 批量校验最大文件数
  file_processing:              # 文件处理设置
    default_encoding: utf-8     # 默认文件编码
    csv_delimiter: ","          # CSV 分隔符
    null_value_strategy: null   # 空值处理策略
    date_format: "%Y-%m-%d"    # 日期格式
  script_security:              # 脚本安全设置
    allow_eval: false           # 禁止 eval() 函数
    allow_exec: false           # 禁止 exec() 函数
    sandbox_mode: true          # 启用沙箱模式
    timeout_seconds: 10         # 脚本执行超时时间（秒）

# Schema 文件索引列表
schemas:
  - id: users                   # 表 ID（必填，必须唯一）
    path: schemas/users.schema.yaml   # 相对路径（必填）

# Constraint 文件索引列表
constraints:
  - id: unique_user_email
    path: constraints/unique_user_email.constraint.yaml

# Regex 节点文件索引列表
regex_nodes:
  - id: phone_number
    path: regex_nodes/phone_number.regex.yaml

# Patterns 目录路径
patterns_dir: patterns
```

#### 字段规范 / Field Specifications

| 字段 | 类型 | 必填 | 说明 |
|-----|------|-----|------|
| `version` | int | 是 | 配置版本号，固定为 2 |
| `project.id` | string | 是 | 项目唯一标识符，建议使用小写+下划线 |
| `project.name` | string | 是 | 项目展示名称 |
| `schemas[].id` | string | 是 | Schema ID，必须唯一 |
| `schemas[].path` | string | 是 | 相对于 manifest 的路径 |
| `constraints[].id` | string | 是 | Constraint ID，必须唯一 |
| `regex_nodes[].id` | string | 是 | Regex ID，必须唯一 |

### 3.2 表结构文件 (*.schema.yaml) / Schema File

```yaml
# ============================================================
# 表结构配置文件
# ============================================================

version: 2

id: users

name: users

source:
  mode: relative_file
  path: data/users.xlsx
  sheet: Sheet1
  header_row: 0

columns:
  - id: user_id
    name: user_id
    type: string
    primary_key: true
    nullable: false
  - id: email
    name: email
    type: string
    nullable: true
  - id: age
    name: age
    type: integer
    nullable: true

# 内嵌约束（可选）
constraints: []

# 脚本检查（可选）
script_checks: []
```

#### 数据类型规范 / Data Type Specifications

| 类型 | 说明 |
|-----|------|
| `string` | 字符串 |
| `integer` | 整数 |
| `decimal` | 小数 |
| `boolean` | 布尔值 |
| `datetime` | 日期时间 |
| `date` | 日期 |
| `time` | 时间 |

---

## 4. 数据校验文件标准 / Data Validation File Standards

### 4.1 约束文件通用结构 / Constraint File General Structure

所有约束文件采用 **refs（引用区）+ params（参数区）** 分离设计：

```yaml
version: 2

id: constraint_id           # 约束唯一标识
type: ConstraintType        # 约束类型
enabled: true               # 是否启用
description: "约束描述"     # 描述信息

# 引用区：定义约束作用的目标对象
refs:
  table_id: table_name
  column_ids: [col1, col2]

# 参数区：约束特定的参数
params:
  # 根据约束类型变化的参数
```

### 4.2 约束类型规范 / Constraint Type Standards

#### 4.2.1 Unique（唯一性约束） / Unique Constraint

```yaml
version: 2
id: unique_user_email
type: Unique
enabled: true
description: "用户邮箱必须唯一"

refs:
  table_id: users
  column_ids: [email]       # 单列或多列组合

params: {}
```

#### 4.2.2 NotNull（非空约束） / NotNull Constraint

```yaml
version: 2
id: email_notnull
type: NotNull
enabled: true
description: "邮箱不能为空"

refs:
  table_id: users
  column_id: email          # 单列

params: {}
```

#### 4.2.3 AllowedValues（允许值约束） / AllowedValues Constraint

```yaml
version: 2
id: gender_allowed
type: AllowedValues
enabled: true
description: "性别只能是男、女、未知"

refs:
  table_id: users
  column_id: gender

params:
  allowed_values: [男, 女, 未知]
```

#### 4.2.4 ForeignKey（外键约束） / ForeignKey Constraint

```yaml
version: 2
id: fk_order_user
type: ForeignKey
enabled: true
description: "订单必须关联有效用户"

refs:
  from_table_id: orders
  from_column_id: user_id
  to_table_id: users
  to_column_id: user_id

params: {}
```

#### 4.2.5 Conditional（条件约束） / Conditional Constraint

```yaml
version: 2
id: adult_status
type: Conditional
enabled: true
description: "年龄大于18岁则标记为成人"

refs:
  table_id: users
  then_column_id: status
  if_conditions:
    - if_column_id: age
      operator: ">"          # 支持: eq, ne, >, >=, <, <=, in, not_in
      value: 18
  if_logic: and              # 多条件逻辑: and/or

params:
  then_value: "成人"
```

#### 4.2.6 Scripted（脚本约束） / Scripted Constraint

```yaml
version: 2
id: valid_email
type: Scripted
enabled: true
description: "验证邮箱格式"

refs:
  table_id: users
  column_id: email

params:
  expression: "validate_email(value)"
```

#### 4.2.7 Range（区间约束） / Range Constraint

```yaml
version: 2
id: price_range
type: Range
enabled: true
description: "商品价格必须在0-10000之间"

refs:
  table_id: products
  column_id: price

params:
  min: 0
  max: 10000
```

### 4.3 正则节点文件 (*.regex.yaml) / Regex Node File

#### 引用模式（推荐） / Pattern Reference Mode (Recommended)

```yaml
version: 2

id: phone_number
name: 手机号校验
description: "校验中国大陆手机号格式"

# 引用预定义模式
uses_pattern:
  registry: patterns
  pattern_name: phone_cn

# 覆盖配置
pattern_overrides:
  flags: "i"

match_mode: full            # full/partial/extract
case_sensitive: false
enabled: true

# 上游表列引用
source_ref:
  table_id: users
  column_id: phone
```

#### 直接模式 / Direct Pattern Mode

```yaml
version: 2

id: email_direct
name: 邮箱校验
description: "校验邮箱格式"

# 直接编写正则
pattern: "^[\\w\\.-]+@[\\w\\.-]+\\.\\w+$"

match_mode: full
enabled: true

source_ref:
  table_id: users
  column_id: email
```

### 4.4 表达式模式文件 (patterns/*.yaml) / Pattern File

```yaml
name: phone_cn

regex: "^1[3-9]\\d{9}$"

description: "中国大陆手机号格式校验"

output:
  type: boolean
  message: "手机号格式不正确"
```

---

## 5. 开发工作流 / Development Workflow

### 5.1 启动开发环境 / Start Development Environment

**Electron 桌面版（推荐）：**
```bash
# 安装所有依赖
npm install
cd electron && npm install

# 启动桌面版
npm run electron:dev

# 桌面版自动启动后端服务
# 前端界面通过 Electron 加载
# 后端 API: http://127.0.0.1:8000（由 Electron 内部管理）
```

**CLI 模式：**
```bash
cd backend
python -m pip install -r requirements.txt

# 执行校验
precis validate --manifest project.precis.yaml --data-directory ./data
```

### 5.2 CLI 使用 / CLI Usage

```bash
# 校验命令
precis validate \
  --manifest path/to/project.precis.yaml \
  --data-directory path/to/data_dir

# 批量校验
precis validate \
  -m project1/project.precis.yaml -d project1/data \
  -m project2/project.precis.yaml -d project2/data
```

### 5.3 文件命名规范 / File Naming Conventions

| 文件类型 | 命名规范 | 示例 |
|---------|---------|------|
| 项目清单 | `project.precis.yaml` | project.precis.yaml |
| Schema | `*.schema.yaml` | users.schema.yaml |
| Constraint | `*.constraint.yaml` | unique_email.constraint.yaml |
| Regex 节点 | `*.regex.yaml` | phone.regex.yaml |
| Pattern | `*.yaml` (在 patterns/ 目录) | phone_cn.yaml |

### 5.4 代码质量与自动格式化 / Code Quality & Auto Formatting

项目采用 **Husky + lint-staged（前端）** 与 **Ruff（后端）** 组合实现提交前自动格式化。

#### 前端（TypeScript / Vue / CSS）

| 工具 | 用途 | 配置 |
|------|------|------|
| ESLint | 代码规范检查与自动修复 | `frontend/eslint.config.js` |
| Prettier | 代码格式化 | `frontend/.prettierrc.json` |
| lint-staged | 仅对暂存文件运行上述工具 | `frontend/package.json` |

#### 后端（Python）

| 工具 | 用途 | 配置 |
|------|------|------|
| Ruff | Lint 检查 + Import 排序 + 代码格式化 | `backend/pyproject.toml` |

**Ruff 关键配置：**
- `line-length = 120`
- `quote-style = "double"`
- 启用规则：`E`, `F`, `I`, `N`, `W`, `UP`
- 忽略规则：`E501`（行过长由 formatter 处理）, `E402`, `N815`

#### Pre-commit 钩子行为

`.husky/pre-commit` 在每次 `git commit` 时自动执行：

```
1. cd frontend && npx lint-staged
   → 仅处理暂存的前端文件（ESLint --fix + Prettier --write）

2. cd backend && python -m ruff check --fix .
   → 自动修复 backend 下所有 Python 文件的 lint 错误

3. cd backend && python -m ruff format .
   → 自动格式化 backend 下所有 Python 文件

4. git add 被 ruff 修改的 Python 文件
   → 确保格式化结果进入本次提交
```

> **注意**：Ruff 检查后端全量文件（约 < 1s），确保历史代码不会在新提交中引入格式回退。

#### 手动运行（推荐在提交前预览）

```bash
# 根目录一键格式化前后端
npm run format:all

# 根目录一键检查前后端
npm run lint:all

# 后端单独格式化
cd backend && python -m ruff format . && python -m ruff check --fix .

# 后端单独检查（不自动修复）
cd backend && python -m ruff check .

# 前端单独格式化
cd frontend && npm run format

# 前端单独检查
cd frontend && npm run lint
```

#### 安装开发依赖

```bash
# 后端开发依赖（含 ruff、pytest、mypy）
cd backend
pip install -e ".[dev]"

# 或单独安装 ruff
pip install ruff
```

---

## 6. 常见任务指南 / Common Task Guide

### 6.1 添加新的约束类型 / Add New Constraint Type

1. 在 `backend/app/shared/domain/constraints/` 添加约束领域逻辑，在 `backend/app/shared/core/project/constraint/types.py` 添加序列化模型
2. 在 `frontend/src/types/constraints.ts` 添加前端类型
3. 在 `frontend/src/composables/nodes/constraints/` 添加组合式函数
4. 更新配置指南文档

### 6.2 添加新的 API 端点 / Add New API Endpoint

1. 在 `backend/app/api/routers/` 创建或修改路由文件
2. 在 `backend/app/api/models/` 目录下添加请求/响应模型（按域分子目录，如 `project.py`、`validation.py`）
3. 在 `backend/app/api/main.py` 注册路由
4. 在 `frontend/src/api/` 添加前端 API 调用

### 6.3 修改配置文件结构 / Modify Configuration Structure

1. 更新 Pydantic 模型（后端）
2. 更新 TypeScript 类型（前端）
3. 更新配置指南文档
4. 更新测试数据示例

---

## 附录：参考资料 / Appendix: References

- [README.md](./README.md) - 项目主要说明
- [docs/](./docs/) - 项目文档目录
- [CHANGELOG.md](./CHANGELOG.md) - 变更日志

---

## 7. AI Provider 配置系统 / AI Provider Configuration System

### 7.1 架构概述 / Architecture Overview

AI Provider 配置系统采用统一的 Provider 架构，支持多种部署方式：

| 部署类型 | 说明 | 示例 |
|---------|------|------|
| **本地** | 本地运行的 AI 服务 | Ollama, LM Studio, LocalAI |
| **内网** | 企业内部部署的私有模型 | 公司私有 LLM |
| **云端** | 公有云 AI 服务 | OpenAI, 阿里云, Google Gemini |

### 7.2 配置文件 / Configuration File

**配置文件位置**: `~/.precis/ai_providers.yaml`

```yaml
schema_version: "1.0"

providers:
  # 本地 Ollama
  - id: ollama-local
    name: Ollama (本地)
    type: ollama
    base_url: http://localhost:11434
    api_key: null
    model: llama3.2

  # 云端 OpenAI
  - id: openai
    name: OpenAI
    type: openai
    base_url: https://api.openai.com/v1
    api_key: ${OPENAI_API_KEY}
    model: gpt-4

defaults:
  chat: ollama-local
  generate: openai
```

**字段说明**:
- `id`: Provider 唯一标识
- `name`: 显示名称
- `type`: Provider 类型 (`openai`, `ollama`)
- `base_url`: API 基础 URL
- `api_key`: API 密钥（本地服务可为 null）
- `model`: 默认模型名称

### 7.3 服务发现 / Service Discovery

系统自动扫描本地 AI 服务：

```
POST /ai/providers/discover
```

扫描的端口：
- Ollama: 11434
- OpenAI 兼容: 1234, 8080, 8000

发现的服务可以通过 `POST /ai/providers/discover/add` 添加到配置。

### 7.4 API 端点 / API Endpoints

#### Provider 管理 / Provider Management
```
GET    /ai/providers                    # 获取所有 Provider
POST   /ai/providers/discover           # 发现本地服务
POST   /ai/providers/discover/add       # 添加发现的服务
POST   /ai/providers/{id}/test          # 测试连接
GET    /ai/providers/defaults           # 获取配置模板
```

#### 聊天 / Chat
```
POST /ai/chat                           # 通用聊天
POST /ai/chat/completions               # OpenAI 兼容接口
```

#### 配置生成 / Config Generation
```
POST /ai/v2/config/generate             # 同步生成
POST /ai/v2/config/generate/jobs        # 创建异步任务
GET  /ai/v2/config/generate/jobs/{id}   # 查询任务状态
```

#### Ollama 管理 / Ollama Management
```
GET /ai/ollama/models                   # 获取模型列表
GET /ai/ollama/health                   # 健康检查
```

### 7.5 核心模块 / Core Modules

```
backend/app/shared/services/llm/
├── config/
│   ├── models.py          # AIProvider, AIConfig 模型
│   └── loader.py          # 配置加载器
├── providers/
│   ├── base.py            # Provider 抽象基类
│   ├── registry.py        # Provider 注册表
│   ├── openai.py          # OpenAI 兼容 Provider
│   └── ollama.py          # Ollama 原生 Provider
├── discovery/
│   └── scanner.py         # 本地服务扫描器
└── generation/
    └── service.py         # AI 配置生成服务
```

### 7.6 开发注意事项 / Development Notes

1. **环境变量**: 支持 `${VAR_NAME}` 语法引用环境变量
2. **自动推断**: `deployment` 字段根据 `base_url` 自动推断（local/remote）
3. **版本兼容**: `schema_version` 用于配置格式版本控制
4. **热重载**: 修改配置文件后，重新加载页面即可生效
5. **不要**将 API Key 提交到版本控制
