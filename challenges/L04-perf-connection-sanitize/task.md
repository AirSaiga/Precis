# L04 — 连接清理服务千边量级性能优化（专家级性能题）

| 项 | 值 |
|------|-----|
| ID | L04 |
| 类型 | 专家级真实仓库任务（性能优化 + 行为等价门） |
| 栈 | TypeScript / Vue 3（vitest） |
| 难度 | ★★★+ |
| 预估 | 40-70 分钟 |

> 本题在**真实 Precis 前端仓库**上操作。目标函数位于
> `frontend/src/services/canvas/connectionPolicyService.ts` 的
> `sanitizeConnections()`（约 115-133 行），它把逐条连接的有效性判定委托给
> `frontend/src/composables/validation/useConnectionValidator.ts`（约 457 行的内部
> `sanitizeConnections`）。请自行阅读这段调用链并完成优化。

## 任务

`connectionPolicyService.sanitizeConnections(nodes, connections)` 用于批量检查画布上
的既有连接并返回无效连接列表。当前实现存在**二次复杂度退化**：对每条连接都在
"合法连接列表"里线性查找（且判定过程中还有其它线性扫描）。当画布边数达到千边量级
（例如从 V2 配置导入大型项目的连接、批量粘贴/模板展开产生的连接）时，总耗时按
O(C²) 增长，肉眼可感知卡顿，数千边时可能挂起数秒。

**优化目标**：把千边量级场景的耗时降到近线性水平（见下方"耗时档"）。

**硬性约束（同等重要）**：

1. **清理结果必须与现状实现完全等价**。优化前后的 `sanitizeConnections(nodes,
   connections)` 返回值必须逐条一致：无效连接列表的**内容、顺序、每条的原因字段**、
   以及哪些连接被判定为合法/非法，全部保持一致。包括且不限于以下边界：
   - 源/目标节点不存在于 nodes 的连接
   - 自连接（source === target）
   - 无匹配规则的节点类型组合
   - handle 不匹配规则约束（含 `undefined` / `null` handle、`{columnId}` 这类
     占位符 handle 模式）
   - 同一对 (source, target) 出现多条连接的重复边场景
   - 注意：**现状判定里可能存在的"可疑"语义也必须原样保留**——这是行为等价题，
     不是语义修正题。任何"顺手修正判定语义"的改动都会导致等价门失败。
2. 只能改变时间/空间复杂度与内部数据结构，不得改变上述可观察行为。
3. 不破坏仓库既有测试（verify 会回归 `frontend/tests/services/canvas/` 与
   `frontend/tests/services/rules/`）。
4. 代码质量门：改动的文件必须通过 ESLint（error 级别）与 vue-tsc 类型检查。

## 验收方式（盲验证）

在本目录运行：

```
node verify.mjs
```

`verify.mjs` 会：

- **等价门（golden-master）**：注入一份隐藏测试，用**现状实现生成的 golden
  参照输出**与你的实现在一组大边集/边界场景上逐条对比。golden 参照实现已固化在
  注入测试内部（不受你的修改影响），与"现状实现"行为完全一致。
- **耗时档**：隐藏测试在**千边量级**数据集上同时测量你的实现与 golden 参照实现
  的耗时（同进程、取多次最小值），按加速比分三档计分。请把千边场景做到数量级
  改善，而不是抠常数。
- **回归门**：完整回归 `frontend/tests/services/canvas/` 与
  `frontend/tests/services/rules/` 下全部既有测试，必须全绿。
- **质量门**：对改动文件运行 ESLint（仅 error 级）与 vue-tsc（过滤出改动文件的
  错误数），0 错误才得分。

评分制输出：stdout 首行 `SCORE: n/m`，随后逐项 `  [i/j] 子项名：说明`。
退出码 0 = 评分完成（仅环境异常才非 0）。临时测试文件运行后自动清理，不污染仓库。

## 提示

- 先精读 `sanitizeConnections` 两层实现（service 包装层 + composable 内部实现），
  把每条连接判定路径上**所有**的线性扫描找全（判定主体、多重连接检查、外层
  列表归并……），只优化其中一处通常不足以进最高耗时档。
- "等价"意味着连无效连接列表的**顺序**都要一致——注意你在用 Map/Set/计数表替换
  线性查找时，迭代顺序与判定时机必须保持原语义。
- 当前实现里对"多重连接"的检查用的是**整张输入表**而非"逐条累积"，优化成
  前缀式/增量式判定会改变结果——隐藏测试专门覆盖这类陷阱。
- 数据规模：隐藏耗时测试为**数千边、上千节点**级场景；等价测试覆盖多种规则
  （含 `allowMultiple: true/false` 两类）与占位符 handle。
