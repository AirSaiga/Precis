# 变更日志 / Changelog

> ⚠️ 本项目处于超早期原型阶段，变更频繁且可能不兼容。以下记录仅供参考。
>
> This project is in an ultra-early prototype stage. Changes are frequent and may be incompatible. The following records are for reference only.

## [Unreleased]

### 说明 / Note

当前为活跃开发中的原型版本，接口、配置格式、命令行参数均可能在不通知的情况下变更。

Currently an actively developed prototype. Interfaces, config formats, and CLI parameters may change without notice.

### 近期变更 / Recent Changes

- 搭建基础项目结构（Electron + Vue 3 + FastAPI）
  
  Set up basic project structure (Electron + Vue 3 + FastAPI)

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

### 已知问题 / Known Issues

- ⚠️ **测试覆盖严重不足** — 核心校验引擎缺乏自动化测试
  
  ⚠️ **Severely lacking test coverage** — Core validation engine lacks automated tests

- ⚠️ **大量已知 Bug** — 边界情况处理不完善
  
  ⚠️ **Many known bugs** — Edge cases are not properly handled

- ⚠️ **配置格式不稳定** — YAML 结构可能随版本调整
  
  ⚠️ **Config format unstable** — YAML structure may change with versions

- ⚠️ **前端状态管理待重构** — 部分画布操作可能引发不一致状态
  
  ⚠️ **Frontend state management pending refactoring** — Some canvas operations may cause inconsistent states

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

- 建立示例项目（qa_v3_complex）
  
  Established example project (qa_v3_complex)
