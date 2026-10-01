---
layout: home

hero:
  name: Precis
  text: 本地优先的可视化数据质量平台
  tagline: 拖拽式 DAG 画布，把 Excel / CSV 数据校验从代码变成可视化操作。数据全程不出本机。
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/quick-start
    - theme: alt
      text: GitHub
      link: https://github.com/AirSaiga/Precis

features:
  - icon: 🧩
    title: 可视化 DAG 拖拽建模
    details: 数据源、Schema、约束、转换在画布上拖拽连线即完成建模，无需编写校验代码，非技术人员也能上手。
  - icon: 🛡️
    title: 10 种约束类型
    details: 非空、唯一、外键、枚举值、范围、条件、脚本、字符集、日期逻辑、组合约束，覆盖常见数据质量规则。
  - icon: 🔒
    title: 本地优先，数据不出本机
    details: 校验全程在本机完成，不向任何服务器上传数据。桌面应用内置运行时，开箱即用。
  - icon: 🌐
    title: 中英双语
    details: 界面支持简体中文与英文切换，校验错误信息随界面语言渲染。
---

> [!WARNING]
> **Precis 当前处于 Alpha 阶段。** 核心功能已实现，API 与配置格式可能调整，暂不建议用于生产环境。欢迎在 [GitHub Issues](https://github.com/AirSaiga/Precis/issues) 与 [Discussions](https://github.com/AirSaiga/Precis/discussions) 反馈问题与想法。

## 演示：从建模到校验

![Precis 数据校验演示：拖拽建模 → 全量校验 → 错误定位](/demo.gif)

完整演示「拖拽节点建模 → 连线建立约束 → 一键全量校验 → 点击失败节点查看错误明细」的流程。

## 三种入口，按需选择

| 入口 | 适合谁 |
| ---- | ------------------------------------------------------------ |
| [桌面应用](/guide/installation) | 日常数据质量检查，零环境配置，推荐大多数用户 |
| [CLI 命令行](/reference/cli) | CI/CD 流水线集成、批量校验、Agent 工具链集成 |
| [REST API](/guide/installation) | 自定义集成与二次开发 |

想立刻上手？从 [快速开始](/guide/quick-start) 出发，几分钟完成第一次数据校验。
