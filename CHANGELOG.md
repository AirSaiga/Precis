# 变更日志 / Changelog

> ⚠️ 本项目处于超早期原型阶段，变更频繁且可能不兼容。以下记录仅供参考。
>
> This project is in an ultra-early prototype stage. Changes are frequent and may be incompatible. The following records are for reference only.

## [Unreleased]

### 说明 / Note

当前为活跃开发中的原型版本，接口、配置格式、命令行参数均可能在不通知的情况下变更。

Currently an actively developed prototype. Interfaces, config formats, and CLI parameters may change without notice.

### 近期变更 / Recent Changes

#### 约束系统 / Constraint System

- 新增 Charset（字符集）、DateLogic（日期逻辑）、Composite（复合）三种约束类型
   
  Added Charset, DateLogic, and Composite constraint types

- 约束节点自注册双注册表模式（NodeDataBuilder + ValidationRegistry）
   
  Dual-registry self-registration pattern for constraint nodes

- 约束规则集（ConstraintRuleSet）节点与分组管理
   
  ConstraintRuleSet nodes and grouping management

#### 转换引擎 / Transform Engine

- 实现 22 种转换类型，支持 DAG 拓扑排序链式执行
   
  Implemented 22 transform types with DAG topological execution

#### 可视化编辑器 / Visual Editor

- 资源树拖拽导入（Schema、Constraint、Regex、Transform）
   
  Resource tree drag-and-drop import

- 模板实例展开系统（Template Expansion）
   
  Template instance expansion system

- 剪贴板（复制/粘贴/重复）与撤销/重做
   
  Clipboard (copy/paste/duplicate) and undo/redo

- 连接规则验证系统（20 条规则）
    
  Connection validation system (20 rules)

- 校验历史面板
   
  Validation history panel

- AI 聊天与配置生成面板
   
  AI chat and config generation panel

- 应用设置工作台
   
  Application settings workspace

- 节点布局组织器（自动排列）
   
  Node layout organizer (auto-arrange)

#### 后端 / Backend

- 后端三层架构重构（core / domain / services）
   
  Backend three-layer architecture refactoring (core / domain / services)

- 校验引擎两阶段流水线（数据加载 → 约束校验）
   
  Validation engine two-stage pipeline (data loading → constraint validation)

- 校验历史持久化存储与查询 API
   
  Validation history persistence and query API

- 多类型内联数据源约束校验
   
  Multi-type inline data source constraint validation

- 配置差异比较服务
   
  Config diff comparison service

#### 基础设施 / Infrastructure

- 统一使用 Vue Flow API 进行 DAG 操作（替代直接数组操作）
   
  Unified Vue Flow API for DAG operations

- V2 持久化流水线（保存/加载完整项目配置）
   
  V2 persistence pipeline (save/load full project config)

- 添加单元测试覆盖（前端 Vitest + 后端 pytest）
   
  Added unit test coverage (Vitest + pytest)

- 排除存在供应链漏洞的 fastapi 版本
   
  Excluded fastapi version with supply chain vulnerability

### 已知问题 / Known Issues

- ⚠️ **测试覆盖基线已建立，但核心引擎与边界场景仍不足** — 前后端单元测试、E2E 测试及 CI 流水线已运行，核心校验引擎的边界 case 和异常路径仍需补充覆盖

  ⚠️ **Test coverage baseline established, but core engine and edge cases still insufficient** — Unit tests (frontend + backend), E2E tests, and CI pipelines are operational, but boundary cases and error paths in the core validation engine need more coverage

- ⚠️ **配置格式不稳定** — YAML 结构可能随版本调整

  ⚠️ **Config format unstable** — YAML structure may change with versions

## [0.1.0] - 2026-04-17

### 说明 / Note

首次代码提交，建立基础框架。此版本仅为内部技术验证，不具备生产可用性。

First code submission, establishing basic framework. This version is for internal technical validation only and is not production-ready.

### 内容 / Contents

- 初始化前端、后端、Electron 三个子项目
   
  Initialized frontend, backend, and Electron subprojects

- 配置 Husky + lint-staged + Ruff 代码格式化流水线
   
  Configured Husky + lint-staged + Ruff code formatting pipeline

- 添加基础 CI 工作流（lint、type-check）
   
  Added basic CI workflow (lint, type-check)

- 实现可视化画布（Vue Flow）基础节点与连线
   
  Implemented visual canvas (Vue Flow) basic nodes and connections

- 实现 V2 配置引擎（project.precis.yaml 驱动）
   
  Implemented V2 config engine (driven by project.precis.yaml)

- 添加基础约束类型：Unique、NotNull、AllowedValues、ForeignKey、Conditional、Range、Scripted
   
  Added basic constraint types: Unique, NotNull, AllowedValues, ForeignKey, Conditional, Range, Scripted

- 添加基础转换节点：StringSplit、RegexExtract、MathExpr、DateFormat 等
   
  Added basic transform nodes: StringSplit, RegexExtract, MathExpr, DateFormat, etc.

- 集成 AI 配置生成服务接口（OpenAI / Ollama）
   
  Integrated AI config generation service interfaces (OpenAI / Ollama)

- 添加国际化支持（zh-CN / en-US）
   
  Added internationalization support (zh-CN / en-US)
