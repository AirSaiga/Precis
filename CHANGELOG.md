# 变更日志 / Changelog

> ⚠️ 本项目处于 Alpha 阶段，核心功能已成型但仍可能有不兼容变更。以下记录仅供参考。
>
> This project is in Alpha stage. Core features are implemented but breaking changes may still occur. The following records are for reference only.

## [Unreleased]

### 说明 / Note

当前为活跃开发中的原型版本，接口、配置格式、命令行参数均可能在不通知的情况下变更。

Currently an actively developed prototype. Interfaces, config formats, and CLI parameters may change without notice.

### 2026-08

- 修复节点整理（自动布局）整体失效的根因缺陷——布局分类器的分类 Map 从未初始化，"Schema 中心化"策略实际从未生效，整理一直退化为按 UUID 随机序的缠绕网格（缺陷由 strictNullChecks 清理批次引入，此前仅在测试注释中被记录而未修复）

  Fixed the root-cause defect that left the node organizer effectively broken — the layout classifier's category maps were never initialized, so the schema-centric strategy never actually ran and organizing always degraded into a UUID-ordered tangled grid (introduced by a strictNullChecks cleanup batch; previously only noted in a test comment, never fixed)

- 节点整理布局优化——约束/正则按 Schema 字段顺序排列（与左侧字段编辑器上下呼应，列 ID 精确匹配、列名兜底）；右侧区块按 fitView 视口适配度自动分栏（1~4 列择优，消除"单列长柱 + 大面积留白"）；超长单节节内换子列且分组框不拆分；可用区估算与 fitView 不对称安全留白对齐

  Node-organizer layout improvements — constraints and regex nodes now follow the schema's field order (echoing the schema editor; matched by column ID with column-name fallback); right-hand blocks auto-balance into 1–4 columns chosen by fitView viewport fitness, eliminating the "single tall column + dead space" layout; oversized sections wrap into sub-columns without splitting their group frame; usable-area estimation now aligns with fitView's asymmetric safe padding

- TUI 动效粒子改为景深分层——字形/亮度/速度/摆幅统一由景深派生（近景大花亮而快、远景小点暗而慢），色相与主题渐变同源；渲染增加防粘连：同帧相邻粒子互相让位，双宽花形（CJK 字体）要求右邻格空白，消除"❄·"糊团与压字；飘雪字形弃用厚重 ❄，正式定为纤细雪晶 ❅（三档 ❅ * ·）

  TUI effect particles are now depth-layered — glyph/brightness/speed/sway all derive from a single depth value (near flakes big, bright and fast; far dots dim and slow), with hue matched to the theme gradient; rendering adds anti-fusion: same-frame adjacent particles yield to each other, and double-width flower glyphs (CJK fonts) require a blank right neighbor, eliminating fused "❄·" blobs and glyph-over-text overlaps; the heavy ❄ snowflake glyph is replaced by the slender crystal ❅ (three tiers: ❅ * ·)

- **移除项目选择首屏，画布成为唯一默认界面**——打开项目统一经管理弹窗
   
  **Removed the project-selector first screen; the canvas is now the sole default view** — opening projects goes through the management dialog

- 安全加固两批：Electron IPC 路径穿越防护与沙箱校验；preview 路径校验、AI 直写 fail-closed、CORS 收紧
   
  Two security hardening batches: Electron IPC path-traversal & sandbox checks; preview path validation, AI direct-write fail-closed, tightened CORS

- 后端写盘纪律统一：全仓原子写
   
  Unified backend write discipline: atomic writes across the codebase

- 修复自检报告"按文件"分组显示 `<unknown>`——引用缺失/数据源重复/Schema ID 重复的 LoadingError 补归属文件路径（manifest 路径优先，缺省按 V2 命名规范推导）
   
  Fixed inspection reports showing `<unknown>` in the by-file grouping — LoadingErrors for missing references / duplicate data sources / duplicate schema IDs now carry the owning file path (manifest path first, falling back to the V2 naming convention)

- 前端多批 UX 与正确性修复：15 项 P0/P1 缺陷、撤销覆盖扩展与草稿守卫、画布加载适配与主题批次、资源树批量操作等
   
  Multiple frontend UX/correctness fix batches: 15 P0/P1 defects, undo-coverage extension & draft guards, canvas load adaptation & theme batch, resource-tree batch operations, etc.

- TUI UX 评审修复批次与前端排版审计修复；full config 响应新增 templates 内容字典，修复模板显示名断链（节点标题/资源树此前只能显示模板 id）
   
  TUI UX review fix batch and frontend typography-audit fixes; the full-config response now includes a templates content dict, fixing broken template display names (node titles and the resource tree previously showed only template ids)

- 修复首次打开全新项目（尚无工作区持久化）时，画布 Tab 初始化误清空已加载节点的问题——bootstrap 与项目管理弹窗两条路径的默认工作区均改为收养当前画布而非重置（弹窗是移除首屏后打开项目的唯一入口；本地曾被 gitignored 运行时状态掩盖，CI E2E 揭示）
   
  Fixed: opening a brand-new project (no persisted workspaces) wiped just-loaded canvas nodes during tab initialization — the default workspace now adopts the current canvas instead of resetting, on both the bootstrap and management-dialog paths (the dialog is the sole project entry point since the first-screen removal; masked locally by gitignored runtime state; exposed by CI E2E)

### 2026-07

- 新增 Rust TUI 终端客户端（ratatui + crossterm + tokio）：双主题、动效、Provider/Chat/校验界面，独立于 Electron 与 Web 前端
   
  Added the Rust TUI terminal client (ratatui + crossterm + tokio): dual themes, animations, Provider/Chat/validation views, independent of Electron and the web frontend

- CLI / TUI 自包含分发打包：内置 Python 运行时，解压即用
   
  Self-contained CLI/TUI distribution packaging with a bundled Python runtime — extract and run

- 校验引擎正确性大修三波次：清理假通过与静默失败类缺陷
   
  Three waves of validation-engine correctness overhauls: eliminated false-pass and silent-failure defects

- `error_handling: stop` 遇错即停；Scripted / Conditional 约束超时可中断
   
  `error_handling: stop` halts on first error; Scripted/Conditional constraints are interruptible on timeout

- Excel 分块校验行号全局连续
   
  Globally continuous row numbers for chunked Excel validation

- 黄金集校验接入：`qa_test/golden` 17 组场景 + CI 校验脚本
   
  Golden-set validation: 17 scenario groups under `qa_test/golden` plus CI check scripts

### 早期变更（~2026-06）/ Earlier Changes (≤ 2026-06)

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

- 连接规则验证系统（22 条规则）
   
  Connection validation system (22 rules)

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
