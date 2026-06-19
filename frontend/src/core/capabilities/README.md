# 能力抽象层（Capability Abstraction Layer）

本目录封装所有与环境（Electron / Web）相关的底层能力，为业务层提供统一接口。

## 设计目标

- **解耦业务层与运行环境**：业务组件/组合式函数不再直接访问 `window.electronAPI` 或调用 `isElectron()`。
- **能力探测优先于环境判断**：UI 层通过 `xxxApi.canXxx` 决定按钮显隐/禁用，而不是判断是否在 Electron 中。
- **Electron 架构保持完整**：能力层内部仍通过 `window.electronAPI` 调用主进程 IPC，不改动 preload / 主进程代码。
- **可测试性**：业务层测试只需 mock 能力接口，无需构造全局 `window.electronAPI`。

## 能力清单

| 能力文件 | 用途 | Electron 实现 | Web 实现 | 能力探测 |
|---------|------|--------------|---------|---------|
| `appApi.ts` | 应用级能力：版本、后端端口/状态、最近项目持久化、后端重启 | IPC (`getAppVersion` / `getServerStatus` / `loadConfig` / `saveConfig` / `restartPythonServer`) | HTTP API + `localStorage` | `canRestoreRecentProject` |
| `dialogApi.ts` | 文件/目录选择 | `showOpenDialog` | `<input type="file">` / `webkitdirectory` + 上传 | `canSelectFiles` / `canSelectDirectory` / `canSelectDirectoryEntries` |
| `fileApi.ts` | 文件读写、上传、扫描目录 | 本地文件 API | HTTP 文件 API | 无（通过结果判断） |
| `shellApi.ts` | 用系统程序/编辑器打开文件、打开外部链接 | `openFile` / `openInEditor` | 下载文件 / 复制路径 | `canOpenLocalFile` / `canOpenInEditor` |
| `updateApi.ts` | 自动更新检查/下载/安装 | `electron-updater` IPC | 返回不支持 | `isSupported` |

## 使用规范

### 业务层如何调用

```typescript
// ✅ 正确：通过能力抽象层
import { shellApi } from '@/core/capabilities/shellApi'

async function openConfig(path: string): Promise<void> {
  const result = await shellApi.openInEditor(path)
  if (!result.success) {
    // 处理错误
  }
}
```

```typescript
// ❌ 错误：直接访问 Electron API
const electronAPI = (window as any).electronAPI
if (electronAPI?.openInEditor) {
  await electronAPI.openInEditor(path)
}
```

### UI 层如何控制显隐

```vue
<!-- ✅ 正确：通过能力探测 -->
<button v-if="shellApi.canOpenLocalFile" @click="openFile(path)">
  打开文件
</button>

<!-- ❌ 错误：直接判断环境 -->
<button v-if="isElectron()" @click="openFile(path)">
  打开文件
</button>
```

### 新增能力时的要求

1. 在 `frontend/src/core/capabilities/` 下新建 `xxxApi.ts`。
2. 定义 `XxxApi` 接口，包含能力探测属性（如 `readonly canXxx: boolean`）。
3. 提供 `ElectronXxxAdapter` 和 `WebXxxAdapter` 两个实现。
4. 导出单例 `xxxApi: XxxApi = isElectron() ? new ElectronXxxAdapter() : new WebXxxAdapter()`。
5. 业务层统一从能力层导入，不直接访问 `window.electronAPI`。

## 迁移记录

以下业务组件/组合式函数已完成迁移：

- `composables/data/useDataSourceImport.ts`
- `composables/data/useDataSourceFileOps.ts`
- `composables/useFileSelection.ts`
- `composables/useAppBootstrap.ts`
- `components/common/AIConfigGeneratorModal.vue`
- `components/common/ProjectManagementModal.vue`
- `components/settings/ProjectInfoPanel.vue`
- `components/settings/DataSourcesSettingsPanel.vue`
- `components/settings/UpdateSettingsPanel.vue`
- `components/settings/AIAssistantSettingsPanel.vue`
- `components/inspection/InspectionDrawer.vue`
- `components/library/data/DataSourceTreeFile.vue`
- `App.vue`
- `core/services/httpClient.ts`（Electron 动态端口获取）

已删除的遗留模块：

- `components/library/DataLibrary/handlers/`（Electron 专用文件处理器，功能已被 `dialogApi` / `fileApi` 覆盖）
