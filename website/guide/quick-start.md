# 快速开始

本页带你用最短路径完成第一次数据校验：先走桌面应用的图形界面流程，再给出纯 CLI 的等价路径。

## 方式一：桌面应用（推荐）

### 1. 安装并启动

从 [安装指南](/guide/installation) 获取桌面应用并启动 Precis。

### 2. 创建项目

点击「新建项目」，选择一个空目录。Precis 会自动生成 `project.precis.yaml` 清单文件。

### 3. 导入数据

把 CSV / Excel / JSON 数据文件放入项目 `data/` 目录，然后从左侧资源树把文件**拖拽到画布**，系统自动创建数据预览节点。

### 4. 定义 Schema

在画布上创建 Schema 节点，声明列名、数据类型与数据源。也可以让 AI 助手根据数据预览自动生成（AI 需在设置中配置提供商）。

### 5. 添加约束

从节点库拖入约束节点（如「唯一」「范围」），连线到 Schema 节点的对应列。也可以在节点属性面板中直接编辑参数。

### 6. 运行校验并查看结果

- **自动校验**：默认开启，连线或修改配置后自动触发
- **手动校验**：点击工具栏「校验」按钮全量执行

校验结果以节点状态颜色标识：✅ 通过（绿色）、❌ 失败（红色）。点击失败节点查看错误详情，包含**行号、列名、违规值、错误类型**，可直接定位到问题数据。

## 方式二：CLI 命令行

适合没有图形界面环境、或想把校验接入流水线的场景。

### 1. 安装

```bash
pip install precis-cli
```

### 2. 准备最小项目

在任意目录创建以下两个文件：

```
my-project/
├── project.precis.yaml
├── schemas/
│   └── users.schema.yaml
└── data/
    └── users.csv
```

`project.precis.yaml`：

```yaml
version: 2
project:
  id: demo
  name: 演示项目
schemas:
  - id: users
    path: schemas/users.schema.yaml
```

`schemas/users.schema.yaml`（含内嵌约束）：

```yaml
version: 2
id: users
name: 用户表
source:
  mode: relative_file
  path: data/users.csv
columns:
  - { name: id, type: integer, primary_key: true, nullable: false }
  - { name: email, type: string, nullable: false }
  - { name: age, type: integer }
constraints:
  - id: email_unique
    type: Unique
    column: email
  - id: age_range
    type: Range
    column: age
    params: { min: 0, max: 150, boundary_mode: inclusive }
```

### 3. 运行校验

```bash
precis validate --manifest ./my-project/project.precis.yaml
```

校验通过显示 ✅ 与统计信息；失败则列出每条违规的行号、列名、违规值与错误类型，退出码为 `1`，可直接用于 CI 流水线门禁。

## 接下来

- 完整命令说明见 [CLI 参考](/reference/cli)
- 全部约束类型与配置格式见 [配置参考](/reference/config)
