# Precis 许可证说明 / License Notice

> ⚠️ **项目状态声明 / Project Status**
>
> Precis 目前处于**超早期原型阶段（Prototype / Pre-Alpha）**。
> - 核心功能框架刚刚搭成，**尚未完成测试覆盖**，已知存在大量 Bug
> - 本仓库**开源仅为展示方向、收集需求反馈**，暂不寻求代码贡献
> - **不建议**在生产环境或关键数据场景中使用
> - 代码随时可能大规模重构，接口和行为均不保证稳定
>
> Precis is currently in **ultra-early prototype stage (Prototype / Pre-Alpha)**.
> - Core framework is just built, **test coverage is severely lacking**, many bugs are known
> - Open-sourced **only to showcase direction and collect feedback**, not seeking contributions
> - **Not recommended** for production or critical data scenarios
> - Code may be massively refactored at any time; interfaces and behaviors are not stable

---

## 许可证类型 / License Type

Precis 采用 **Apache License 2.0 (Apache-2.0)**

## 核心条款 / Core Terms

### ✅ 您可以自由地进行以下操作 / You are free to:

| 权利 Right | 说明 Description |
|------------|-----------------|
| **查看与学习** View & Learn | 阅读源代码以了解实现思路 Read source code to understand implementation |
| **个人试用** Personal Trial | 在本地环境运行以评估是否满足您的需求 Run locally to evaluate if it meets your needs |
| **修改** Modify | 修改代码以适应您的需求（需遵守许可证义务）Modify code to suit your needs (subject to license obligations) |
| **分发** Distribute | 分发原始或修改后的版本（需保留许可证声明）Distribute original or modified versions (keep license notices) |
| **专利授权** Patent Grant | 贡献者授予您明确的专利使用权 Contributors grant you explicit patent rights |

### ⚠️ 您必须遵守以下义务 / You must:

| 义务 Obligation | 说明 Description |
|-----------------|-----------------|
| **保留声明** Retain Notices | 保留所有版权声明和许可证文本 Retain all copyright notices and license text |
| **变更说明** State Changes | 修改文件需注明变更内容 Note changes to modified files |
| **NOTICE 文件** NOTICE File | 如项目包含 NOTICE 文件，衍生作品需保留其中的归属声明 If NOTICE file exists, derivative works must preserve attributions |

### ❌ 禁止的行为 / Prohibited:

- 使用本项目的商标（如 "Precis" 品牌标识）进行商业推广，除非获得明确授权
- 声称项目原始作者对您的衍生作品提供背书

- Use this project's trademarks (e.g., "Precis" brand identity) for commercial promotion without explicit authorization
- Claim that the original author endorses your derivative work

## 与 AGPL-3.0 的主要区别 / Comparison with AGPL-3.0

| 特性 Feature | Apache-2.0 | AGPL-3.0 |
|-------------|------------|----------|
| **网络服务义务** Network Service Obligation | 无强制开源义务 None | 对外提供网络服务时必须开源 Must open-source when providing network services |
| **专利授权** Patent Grant | 包含明确的专利授权条款 Explicit | 包含隐含的专利授权 Implicit |
| **衍生作品许可** Derivative Works | 允许闭源衍生作品 Permits closed-source | 衍生作品必须使用相同许可证 Same license required |
| **商业友好度** Business Friendliness | 高 High | 中（对 SaaS 场景约束较强）Medium (strong SaaS constraints) |

## 未来许可策略 / Future Licensing Strategy

当前版本采用 Apache-2.0 开源。项目进入正式发布阶段后，可能调整为**双许可证**（社区版 Apache-2.0 + 企业版商业许可），但这不影响当前版本的授权。

The current version is released under Apache-2.0. After entering official release stage, the project may adopt a **dual-license** (Community Apache-2.0 + Enterprise Commercial License), which does not affect the authorization of the current version.

## 第三方依赖 / Third-Party Dependencies

本项目使用了大量第三方开源库，各库遵循其自身的许可证。详细信息请参见各子项目的依赖清单：

This project uses numerous third-party open-source libraries, each under its own license. See dependency manifests in subprojects:

- **前端 Frontend**: `frontend/package.json`
- **后端 Backend**: `backend/pyproject.toml`
- **桌面端 Desktop**: `electron/package.json`

## 免责声明 / Disclaimer

本项目按"原样"提供，不附带任何明示或暗示的担保。当前为超早期原型，可能存在数据丢失、崩溃或其他不可预期的问题。详见 `LICENSE` 文件第 7、8 条。

This project is provided "as is", without warranty of any kind, express or implied. As an ultra-early prototype, data loss, crashes, or other unexpected issues may occur. See Sections 7 and 8 of the `LICENSE` file.

## 联系方式 / Contact

如有许可证相关问题，请通过 GitHub Discussions 联系我们。

For license-related questions, please contact us via GitHub Discussions.
