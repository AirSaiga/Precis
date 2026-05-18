# Precis 前端项目

## 🎉 架构重构完成！

本项目已完成全面的架构重构（2026-01-14），代码结构更加清晰、易于维护和扩展。

---

## 📚 快速开始

### 安装依赖

```bash
npm install
```

### 开发环境

```bash
npm run dev
```

### 生产构建

```bash
npm run build
```

---

## 📂 项目结构

```
src/
├── api/                    # API接口层
│   ├── validationApi.ts   # 校验API
│   └── workspaceApi.ts    # 工作区API
│
├── components/             # 组件层
│   ├── canvas/            # 画布组件
│   ├── layout/            # 布局组件
│   ├── library/           # 资源库组件
│   ├── nodes/             # 节点组件
│   ├── shared/            # 共享组件
│   └── icons/             # 图标组件
│
├── composables/            # 组合式函数（按功能分组）
│   ├── canvas/            # 画布相关
│   ├── connections/       # 连接相关
│   ├── nodes/             # 节点相关
│   ├── preview/           # 预览相关
│   ├── project/           # 项目相关
│   └── validation/        # 校验相关
│
├── core/                   # 核心功能层
│   ├── managers/          # 管理器
│   ├── registry/          # 注册表
│   └── services/          # 核心服务
│
├── features/               # 功能模块
│   ├── regex/             # 正则表达式功能
│   ├── constraints/       # 约束功能（预留）
│   └── schema/            # Schema功能（预留）
│
├── i18n/                   # 国际化
├── router/                 # 路由
├── stores/                 # 状态管理（Pinia）
├── types/                  # TypeScript类型定义
├── utils/                  # 工具函数
├── views/                  # 视图页面
├── App.vue                 # 根组件
└── main.ts                 # 入口文件
```

---

## 🔧 技术栈

- **框架**: Vue 3 + TypeScript
- **构建工具**: Vite
- **状态管理**: Pinia
- **图形库**: Vue Flow
- **样式**: CSS
- **国际化**: Vue I18n
- **路由**: Vue Router

---

## 📖 重构文档

本项目经过了全面的架构重构，相关文档位于项目根目录：

1. **[README_REFACTOR.md](./README_REFACTOR.md)** ⭐ 推荐首读
   - 文档索引和快速指南
   - 常见问题解答

2. **[ARCHITECTURE_REFACTOR.md](./ARCHITECTURE_REFACTOR.md)**
   - 详细的架构设计方案
   - 当前架构分析
   - 新架构设计说明

3. **[REFACTOR_GUIDE.md](./REFACTOR_GUIDE.md)**
   - 实施指南和操作手册
   - 后续步骤说明

4. **[REFACTOR_SUMMARY.md](./REFACTOR_SUMMARY.md)**
   - 工作总结和进度统计
   - 收益说明

5. **[REFACTOR_FINAL_STATUS.md](./REFACTOR_FINAL_STATUS.md)**
   - 最终状态报告
   - 修复清单

---

## 🎯 核心特性

### 清晰的模块划分

- **API层**: 统一管理与后端的通信
- **核心层**: 封装核心业务逻辑
- **功能模块**: 独立的功能模块，易于维护和扩展
- **组件层**: 按功能分类的Vue组件

### 类型安全

- 完整的TypeScript类型定义
- 类型按功能模块拆分
- 向后兼容的类型导出

### 代码组织

- Composables按功能分组
- 组件按职责分类
- 清晰的import路径

---

## 🚀 开发指南

### 添加新功能

1. **创建功能模块** (如需要)

   ```
   src/features/your-feature/
   ├── components/      # 功能专属组件
   ├── composables/     # 功能专属组合式函数
   ├── services/        # 功能专属服务
   └── types/           # 功能专属类型
   ```

2. **添加新组件**
   - 布局组件 → `components/layout/`
   - 画布组件 → `components/canvas/`
   - 节点组件 → `components/nodes/`
   - 共享组件 → `components/shared/`

3. **添加新的Composable**
   - 按功能分组放入对应目录
   - 例如：节点相关 → `composables/nodes/`

4. **添加新的类型**
   - 按功能创建新的类型文件或添加到现有文件
   - 在 `types/index.ts` 中导出

### 代码规范

- 使用TypeScript进行类型定义
- 遵循Vue 3 Composition API风格
- 组件使用`<script setup>`语法
- 使用Pinia进行状态管理
- 使用相对路径或`@/`别名导入

---

## 🔍 常用命令

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 类型检查
npm run type-check

# 代码格式化
npm run format

# 构建生产版本
npm run build

# 预览生产构建
npm run preview
```

---

## 📝 注意事项

### Import路径

推荐使用新的模块化import：

```typescript
// ✅ 推荐：使用模块化类型导入
import type { SchemaNodeData } from '@/types/nodes'
import type { RegexNodeData } from '@/types/regex'

// ✅ 也可以：使用统一导出（向后兼容）
import type { SchemaNodeData, RegexNodeData } from '@/types/graph'

// ✅ 推荐：使用新的路径
import { ValidationService } from '@/core/services/validationService'
import { useNodeOperations } from '@/composables/nodes/useNodeOperations'
```

### 文件组织

- 功能相关的文件放在一起
- 使用清晰的命名
- 遵循现有的目录结构

---

## 🤝 贡献指南

1. 阅读架构文档了解项目结构
2. 遵循代码规范
3. 充分测试你的更改
4. 提交清晰的commit信息

---

## 📞 获取帮助

- 查看重构文档了解架构设计
- 阅读代码注释和类型定义
- 参考现有代码示例

---

## 📊 项目状态

- ✅ 架构重构：完成
- ✅ 类型定义：完成
- ✅ 模块化：完成
- ✅ 文档：完整

**最后更新**: 2026-01-14

---

## 🎊 致谢

感谢所有为项目重构做出贡献的开发者！

新的架构为项目的长期发展奠定了坚实的基础。

---

**Made with ❤️ by Precis Team**
