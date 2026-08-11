# C18-dbg-vueflow-push-race — 修复 nodes.value.push 不触发 watcher 的同步竞态

| 项 | 值 |
|----|-----|
| ID | C18 |
| 维度 | dbg（调试与 bug 修复） |
| 栈 | TS（JS，CommonJS） |
| 难度 | ★★★ |
| 预估 | 20-35 分钟 |
| 依赖 | Node ≥20 |

## 背景

`workspace/nodeStore.js` 里有一个 `createNodeStore()` 工厂，它是真实 Vue Flow 节点同步契约的**合成复现**（真实源码不在本仓库，本题为便于 `node` 直接 `require` 而用纯 JS 写成）。这个 store 模拟 Vue Flow 通过 pausable watcher 把业务层的 `nodes` ref 同步到内部渲染状态的过程。

**这是 Precis 代码库里一个真实陷阱的简化版**，见主仓库 `AGENTS.md` 的"Vue Flow DAG 操作规范 / 禁止操作"一节：

> `nodes.value.push(newNode)` — Vue Flow 的 pausable watcher 追踪 ref 值引用，push 不触发。节点在 Vue Flow 内部完全不存在。

Vue Flow 的 pausable watcher 监听 `nodes` ref 时，追踪的是 ref 的**值引用**：

- **赋值**（`nodes.value = [...]`）→ 引用变了 → watcher 触发 → 内部状态同步 → 节点渲染出来
- **mutation**（`nodes.value.push(x)`）→ 引用没变（还是同一个数组对象）→ watcher **不触发** → 内部状态不同步 → 节点在 Vue Flow 内部完全不存在

后果是灾难性的：push 进去的节点**不渲染**、`findNode` **找不到**、给它连边会失败、后续操作全部错乱——而且没有任何报错，问题只在渲染层静默显现。

在本 workspace 里，store 用 `_flush()` 显式模拟 watcher 的一次"检查 + 回写"（真实 Vue Flow 用调度器轮询，语义等价）：`_flush()` 比较 `ref.value` 与上次见到的引用，变了才 `sync()`。

**先读 `workspace/nodeStore.js`**，理解：

- `createNodeStore()` 返回 `{ ref, _flush, _getInternalState, addNodeBuggy, addNodeCorrect }`
- `ref.value` 是逻辑节点列表（业务层改它），`internalState` 是 Vue Flow 内部状态（渲染来源）
- `_flush()`：引用比较检测变化，变了才 sync（model→store 回写）
- `addNodeBuggy(node)`：用 `ref.value.push(node)` —— **不换引用**，`_flush` 检测不到，节点不会进 `internalState`
- `addNodeCorrect(node)`：**TODO**，当前是空函数体，挑战者要实现正确版本

## 任务

实现 `addNodeCorrect(node)`，使得调用它之后跑一次 `_flush()`，节点**能**出现在 `_getInternalState()` 里。修复要点：用**赋值**（产生新数组引用）替代 push，让 watcher 的引用比较检测到变化。

### 规格

- **函数名/签名**：`addNodeCorrect(node)`（保持不变，仍是 store 返回对象上的方法）
- **文件**：`workspace/nodeStore.js`（只改这一个文件）
- **行为契约**：
  - 调用 `addNodeCorrect(node)` 后跑 `store._flush()`，`store._getInternalState()` 必须**包含**该 node（且在数组末尾，按添加顺序）
  - 连续多次调用 `addNodeCorrect` 添加的节点，flush 后全部可见，顺序与添加顺序一致
  - `addNodeBuggy` **必须仍然坏**（push 不同步）——不许改 watcher/sync 逻辑来"顺便修好" buggy 那条路径
- **可接受的修复**（任一，verify 全部兼容）：
  - **Option A（推荐 / AGENTS.md 正解）**：`ref.value = [...ref.value, node]` —— 展开成新数组再赋值，新引用触发 sync
  - **Option B**：`ref.value = ref.value.concat([node])` —— `concat` 返回新数组，同样换引用
  - **Option C**：任何"产生新数组引用并赋值给 `ref.value`"的等价写法（如 `ref.value = [...ref.value]; ref.value.push(node)` 这种"先复制再 push"也可，只要最终 `ref.value` 是个新引用且包含 node）

### 约束（务必遵守）

- 只改 `workspace/nodeStore.js`。
- 不碰 `seed/`、`verify.mjs`、`task.md`、`SOLUTION.md`、`workspace/watcher.js`。
- 不碰 `workspace/` 以外的任何文件（即不要改主仓库代码）。
- 不引入外部依赖（只用 Node 标准库 / 纯 JS）。
- **不要改 `addNodeBuggy`、`_flush`、`sync`、`_getInternalState`、`createNodeStore` 的返回结构**——只填 `addNodeCorrect` 的函数体。改 watcher 逻辑来"让 push 也能同步"属于绕过本题考点（reference vs mutation），verify 会检查 `addNodeBuggy` 仍然不同步来防这种绕过。
- 保持 `module.exports = { createNodeStore }` 的命名导出结构。

### 提示

- **核心心智模型**：watcher 比较的是 `ref.value !== lastSeenRef`。push 在原数组上追加元素，数组对象身份不变，比较结果恒为 `false` → 不触发 sync。赋值则让 `ref.value` 指向一个**新的**数组对象，比较为 `true` → 触发 sync。
- **关键决策点**：`ref.value = [...ref.value, node]` 是 AGENTS.md "增量走 API，全量走数组替换" 约定的规范化写法。展开运算符 `...` 会创建新数组，赋值换引用，两步合一。**不要**写成 `ref.value.push(node)`（哪怕是先 `[...ref.value]` 复制一份再 push 也行，但纯 push 不行）。
- 想验证你的修复是否真的"换引用"：在脑子里跑一遍 `ref.value !== lastSeenRef`——只要你的写法让 `ref.value` 成了新对象，就过了。
- `addNodeCorrect` 是**幂等安全**的：连续调用时，每次都基于当前 `ref.value` 展开再赋值，前一次添加的节点会被保留（因为 `[...ref.value, node]` 展开的是当前完整内容）。
- 混合场景（先 buggy 后 correct）：buggy 的 push 把节点塞进了原数组，correct 的 `[...ref.value, node]` 会把那个节点也一起展开进新数组——所以 correct 之后 flush，buggy 加的节点也会"顺便"可见。这是预期行为（不是 bug），verify 只要求 correct 加的节点可见。

### 验证

在本题目录下运行：

```bash
node verify.mjs
```

退出码 0 = PASS，非 0 = FAIL。6 项检查涵盖：模块可加载、`createNodeStore` 是函数、`addNodeCorrect` 加节点后 flush 能同步、`addNodeBuggy` 仍不同步（防绕过）、混合场景 correct 节点可见、连续多次 correct 全部可见。

完成后按 [challenges/README.md](../README.md) 填 `workspace/RESULT.md`。
