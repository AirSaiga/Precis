# 安全说明 / Security Notice

> ⚠️ **超早期原型警告 / Ultra-Early Prototype Warning**
>
> Precis 目前处于超早期开发阶段，**尚未经过安全审计**，**不建议处理敏感或生产数据**。
> Precis is in ultra-early development, **has not undergone security auditing**, and **is not recommended for handling sensitive or production data**.
>
> 以下安全实践为计划中的设计，而非已完成的安全保证。
> The security practices below are planned designs, not completed security guarantees.

## 已知风险 / Known Risks

| 风险项 Risk | 状态 Status | 说明 Description |
|------------|-------------|-----------------|
| 无安全审计 No security audit | ⚠️ 未开始 Not started | 代码未经过第三方安全审查 Code has not undergone third-party security review |
| 沙箱脚本执行 Sandboxed script execution | 🔄 计划中 Planned | 脚本约束计划使用受限执行环境 Scripted constraints planned to use restricted execution environment |
| 依赖安全 Dependency security | 🔄 依赖 CI 扫描 CI scanning | 使用 Dependabot 和 pip-audit 进行基础扫描 Basic scanning via Dependabot and pip-audit |
| 输入验证 Input validation | 🔄 完善中 In progress | 前端和后端的输入校验尚未覆盖全部边界情况 Frontend and backend input validation does not yet cover all edge cases |

## 安全漏洞报告 / Reporting Vulnerabilities

如果你发现潜在的安全问题：

If you discover a potential security issue:

1. **请勿**公开提交 Issue 或 Discussion / **Do not** publicly submit an Issue or Discussion
2. 请通过 GitHub Security Advisories 私下报告，或发送邮件给维护者 / Please report privately via GitHub Security Advisories, or email the maintainers
3. 请提供问题描述、复现步骤和影响评估 / Please provide a description, reproduction steps, and impact assessment

## 安全实践（目标设计）/ Security Practices (Target Design)

- 用户提供的脚本（Scripted 约束）运行在受限的 `simpleeval` 沙箱中
  
  User-provided scripts (Scripted constraints) run in a restricted `simpleeval` sandbox

- 默认禁用任意代码执行
  
  Arbitrary code execution is disabled by default

- 无原始 SQL 查询 — 所有数据库操作使用 ORM
  
  No raw SQL queries — all database operations use ORM

- 依赖项固定并定期扫描
  
  Dependencies are pinned and regularly scanned

## 免责声明 / Disclaimer

由于项目处于超早期阶段，我们**无法对任何数据泄露、代码执行或系统损害承担责任**。请仅在隔离的本地环境中试用。

As the project is in an ultra-early stage, we **cannot be held liable for any data breaches, code execution, or system damage**. Please trial only in an isolated local environment.
