# Precis 前端 / Precis Frontend

> ⚠️ **Alpha** — 核心功能已成型并配套单元测试（1400+ 用例），但仍在打磨稳定性，接口可能调整。

Vue 3 + TypeScript 可视化编辑器，基于 Vue Flow 画布引擎。

完整项目说明请见 [根目录 README.md](../README.md)。

---

## 技术栈

| 技术               | 用途                      |
| ------------------ | ------------------------- |
| Vue 3 + TypeScript | 框架                      |
| Vite 8             | 构建工具                  |
| Pinia              | 状态管理                  |
| Vue Flow           | 画布/DAG 引擎             |
| Vue Router         | 路由                      |
| Vue I18n           | 国际化（zh-CN / en-US）   |
| CodeMirror         | 代码编辑器（YAML/Python） |
| Axios              | HTTP 客户端               |

---

## 快速开始

```bash
npm install
npm run dev
```

---

## 项目结构

```
src/
├── api/                    # 后端 API 客户端（projectV2Api 等）
├── components/             # UI 组件
│   ├── ai/                 # AI 聊天与配置生成
│   ├── canvas/             # 画布容器与控制
│   ├── common/             # 通用组件
│   ├── layout/             # 布局（AppHeader、Sidebar 等）
│   ├── library/            # 资源库面板
│   ├── nodes/              # 节点组件
│   │   ├── core/           # Schema、数据源预览
│   │   ├── constraintRules/# 10 种约束节点
│   │   ├── constraintSets/ # 约束规则集节点
│   │   ├── sets/           # Schema/Regex/Table 集合节点
│   │   ├── patterns/       # 转换节点
│   │   ├── regex/          # 正则节点
│   │   ├── manualData/     # 手动数据节点
│   │   ├── template/       # 模板实例节点
│   │   ├── composite/      # 复合节点
│   │   ├── json/           # JSON Schema 节点
│   │   ├── root/           # 项目根节点
│   │   └── shared/         # 共享节点组件
│   ├── resource/           # 资源树面板
│   ├── settings/           # 设置工作台
│   ├── template/           # 模板管理
│   ├── ui/                 # 基础 UI 组件
│   └── validationHistory/  # 校验历史面板
├── composables/            # Vue 组合式函数
│   ├── canvas/             # 画布相关（连接监听、Vue Flow API）
│   ├── common/             # 通用（快捷键、剪贴板）
│   ├── conflict/           # 冲突检测
│   ├── data/               # 数据操作
│   ├── nodes/              # 节点操作
│   ├── project/            # 项目生命周期
│   ├── resource/           # 资源管理
│   ├── shared/             # 共享逻辑
│   ├── template/           # 模板操作
│   ├── validation/         # 校验相关
│   └── useAppBootstrap.ts  # 应用启动编排
├── core/                   # 核心功能
│   ├── managers/           # 管理器
│   ├── registry/           # 注册表
│   └── services/           # 核心服务（HTTP、日志、Toast）
├── features/               # 垂直功能模块
│   ├── ai-config-generator/# AI 配置生成器
│   ├── keyboard/           # 键盘快捷键
│   ├── node-layout-organizer/ # 节点布局组织器
│   └── regex/              # 正则功能
├── i18n/                   # 国际化（zh-CN / en-US）
├── router/                 # Vue Router 路由
├── services/               # 业务服务
│   ├── api/                # API 服务
│   ├── builders/           # V2 配置构建器
│   ├── canvas/             # 画布服务（连接策略、Vue Flow API）
│   ├── constraints/        # 约束系统（双注册表 + 校验编排）
│   ├── disconnect/         # 断开连接清理
│   ├── managers/           # 服务管理器
│   ├── registry/           # 服务注册表
│   ├── reportExport/       # 报告导出
│   ├── rules/              # 连接规则（20 条）
│   └── validationReportViewModel.ts
├── stores/                 # Pinia 状态管理
│   ├── graphStore/         # 画布核心 Store（Setup Store + 工厂模块）
│   │   ├── setup/           # 入口（state.ts + computed.ts + assembly.ts + index.ts）
│   │   └── modules/        # 工厂模块（factories/ v2/ clipboard/ history/ ...）
│   ├── canvasStore.ts      # 画布状态
│   ├── canvasTabStore.ts   # 多标签画布
│   ├── workspaceStore.ts   # 数据源工作区
│   ├── resourceTreeStore.ts # 资源树
│   ├── resourceFolderStore.ts # 资源树展开状态
│   ├── resourceSearchStore.ts # 资源搜索
│   ├── resourceDragStore.ts # 资源拖拽状态
│   ├── dragStore.ts        # 拖拽状态
│   ├── projectStore.ts     # 项目状态
│   ├── projectSettingsStore.ts # 项目设置
│   ├── settingsStore.ts    # 设置状态
│   ├── settingsPreferencesStore.ts # 偏好设置
│   ├── settingsNavStore.ts # 设置导航
│   ├── aiChatStore.ts      # AI 聊天
│   ├── expressionStore.ts  # 表达式管理
│   ├── scriptEditorStore.ts # 脚本编辑器
│   ├── validationTaskStore.ts # 校验任务
│   ├── inspectionStore.ts  # 检查/校验结果
│   └── ...
├── types/                  # TypeScript 类型定义
│   ├── graph.ts            # 节点/边核心类型
│   ├── nodes.ts            # CustomNodeData discriminated union
│   ├── constraints.ts      # 约束类型
│   ├── projectV2.ts        # V2 项目配置类型
│   └── ...
├── utils/                  # 工具函数
├── App.vue                 # 根组件
└── main.ts                 # 入口文件
```

---

## 核心架构

### graphStore（God Store + 工厂模块）

画布核心状态管理采用 Pinia Setup Store + 工厂模块拆分模式。`setup/index.ts` 通过多个 `createXxxModule()` 工厂函数组合所有功能，每个模块通过闭包参数注入响应式依赖。

**关键约定**：所有节点数据修改必须通过 `updateNodeData(nodeId, patches)` 统一入口。

### 约束系统（双注册表）

- **NodeDataBuilder**（`services/constraints/nodeDataBuilder/`）— 构建约束节点数据
- **ValidationRegistry**（`services/constraints/validationRegistryCore.ts`）— 执行约束校验

每个 builder/handler 文件在模块级别调用 `registerBuilder()` 或 `register()`，通过 barrel 文件的 side-effect import 触发注册。

### 连接系统

连接规则定义在 `services/rules/connectionRules.ts`（20 条规则），通过 `connectionPolicyService` 验证连线合法性，`useCanvasConnectionWatcher` 监听边变化并同步状态。

---

## 开发命令

```bash
npm run dev              # 启动开发服务器
npm run build            # 生产构建（含 type-check）
npm run type-check       # vue-tsc 类型检查
npm run lint             # ESLint + style audit
npm run format           # Prettier 格式化
npm run test             # Vitest 单元测试
npm run test:watch       # Vitest watch 模式
```

---

## 开发约定

- 组件使用 `<script setup lang="ts">` + Composition API
- 组合式函数以 `use*` 命名
- Store 以 `use*Store` 命名
- Props 必须定义类型（`interface Props` + `defineProps<Props>()`）
- 非功能专属的共享类型放 `types/`
- DAG 操作必须通过 `services/canvas/vueFlowApi.ts` 调用 Vue Flow 原生 API
- 创建节点后、创建边之前必须 `await nextTick()`
