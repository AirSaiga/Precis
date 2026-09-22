/*
 * SPDX-License-Identifier: Apache-2.0
 *
 * Copyright 2026 Precis Team
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/**
 * @fileoverview 画布视图模式 E2E（P3 前半：仅异常 / 聚焦 / 刷新恢复）
 *
 * 夹具：两个 Schema（vw_users / vw_orders），约束刻意控制在聚合阈值之下
 *（每表 ≤ 3 张卡，不建坞，卡片直接可见）：
 * - vw_users：NotNull(name) 全通过 → pass 卡；Range(age 0-120) 含 150 违规 → error 卡
 * - vw_orders：NotNull(order_id) 全通过 → pass 卡
 *
 * 验证：
 * 1. 仅异常：pass 卡隐藏、error 卡保留、非约束节点（两 Schema）不受影响
 * 2. 聚焦：选中 vw_users 后开聚焦 → vw_orders 及其卡被隔离，vw_users 闭包保留
 * 3. 刷新恢复：localStorage 按项目分桶持久化，reload 后模式与过滤效果还原
 * 4. 回全景 + 关仅异常：全部恢复可见
 */
import { test, expect } from "../fixtures/base";
import {
  openProjectOnCanvas,
  waitForHydrationSettled,
} from "../fixtures/openProject";
import * as fs from "fs";
import * as path from "path";

type Page = import("@playwright/test").Page;

const VW_USERS_SCHEMA = `version: 2
id: vw_users
name: vw_users
description: 视图模式夹具：用户表（name 全非空 → pass；age 含 150 违规 → error）
source:
  mode: relative_file
  path: data/vw_users.csv
columns:
  - {id: name, name: name, type: string}
  - {id: age, name: age, type: integer}
constraints:
  - id: vw_name_notnull
    type: NotNull
    column: name
  - id: vw_age_range
    type: Range
    column: age
    params: {min: 0, max: 120, boundary_mode: inclusive}
`;

const VW_USERS_CSV = `name,age
alice,30
bob,150
`;

const VW_ORDERS_SCHEMA = `version: 2
id: vw_orders
name: vw_orders
description: 视图模式夹具：订单表（order_id 全非空 → pass）
source:
  mode: relative_file
  path: data/vw_orders.csv
columns:
  - {id: order_id, name: order_id, type: string}
  - {id: amount, name: amount, type: float}
constraints:
  - id: vw_oid_notnull
    type: NotNull
    column: order_id
`;

const VW_ORDERS_CSV = `order_id,amount
A1,10.5
A2,20.0
`;

/** 内联约束物化卡片 id 约定：{schemaId}_{constraintId}（对齐 constraint-dock spec） */
const USERS_PASS_CARD = "vw_users_vw_name_notnull";
const USERS_ERROR_CARD = "vw_users_vw_age_range";
const ORDERS_PASS_CARD = "vw_orders_vw_oid_notnull";

/** 最小清单：只含两个夹具 Schema（避免整包 qa_simple 实体在重开时全量水合拖慢/乱序） */
const MINIMAL_MANIFEST = `version: 2
project:
  id: vw_modes
  name: 视图模式夹具工程
settings:
  validation:
    auto_validate: false
    strict_mode: false
    error_handling: continue
    timeout_seconds: 30
schemas:
- id: vw_users
  path: schemas/vw_users.schema.yaml
- id: vw_orders
  path: schemas/vw_orders.schema.yaml
data_sources:
- id: primary
  path: data
  mode: relative
`;

function writeFixture(isolatedProjectPath: string) {
  fs.writeFileSync(
    path.join(isolatedProjectPath, "schemas", "vw_users.schema.yaml"),
    VW_USERS_SCHEMA,
  );
  fs.writeFileSync(
    path.join(isolatedProjectPath, "schemas", "vw_orders.schema.yaml"),
    VW_ORDERS_SCHEMA,
  );
  fs.writeFileSync(
    path.join(isolatedProjectPath, "data", "vw_users.csv"),
    VW_USERS_CSV,
  );
  fs.writeFileSync(
    path.join(isolatedProjectPath, "data", "vw_orders.csv"),
    VW_ORDERS_CSV,
  );
  fs.writeFileSync(
    path.join(isolatedProjectPath, "project.precis.yaml"),
    MINIMAL_MANIFEST,
  );
}

async function openResourceTree(page: Page) {
  // 检查器抽屉可能处于展开态并拦截左侧 activity-bar 点击，先关闭
  const drawer = page.locator(".inspection-drawer");
  if (await drawer.isVisible().catch(() => false)) {
    await drawer
      .locator('button[title="关闭"]')
      .first()
      .click({ timeout: 3000 })
      .catch(() => {});
    await expect(drawer)
      .toBeHidden({ timeout: 5000 })
      .catch(() => {});
  }
  await page
    .locator('.activity-bar-nav .view-btn[title="项目资源"]')
    .first()
    .click();
  const tree = page.locator(".resource-tree");
  await expect(tree).toBeVisible({ timeout: 10_000 });
  return tree;
}

/** 拖拽资源树 Schema 到画布，弹窗选指定按钮（复用 constraint-dock spec 的夹具模式）；dropRatio 为落点在画布内的相对位置 */
async function dragSchemaToCanvas(
  page: Page,
  schemaName: string,
  dialogChoice: string,
  dropRatio: { x: number; y: number },
) {
  const tree = page.locator(".resource-tree");
  const dataModelsRoot = tree
    .locator(".tree-folder.root-item > .tree-row.folder-row")
    .filter({ hasText: "数据模型" });
  const schemasNested = tree
    .locator(".tree-folder.nested > .tree-row.folder-row")
    .filter({ hasText: "数据 Schema" });

  if (
    !(await schemasNested
      .first()
      .isVisible()
      .catch(() => false))
  ) {
    await dataModelsRoot.first().click();
    await page.waitForTimeout(500);
  }
  if (
    !(await schemasNested
      .first()
      .isVisible()
      .catch(() => false))
  ) {
    throw new Error("数据 Schema 文件夹未展开");
  }
  const anySchemaFileVisible = await tree
    .locator(".tree-folder.nested .tree-row.file-row")
    .first()
    .isVisible()
    .catch(() => false);
  if (!anySchemaFileVisible) {
    await schemasNested.first().click();
    await page.waitForTimeout(500);
  }

  const schemaItem = tree
    .locator(".tree-row.file-row")
    .filter({ hasText: schemaName })
    .first();
  const canvas = page.locator(".vue-flow__pane");

  let dismissOverlay = true;
  const dismissTask = (async () => {
    const overlay = page.locator(".global-confirm-overlay");
    while (dismissOverlay) {
      if (await overlay.isVisible().catch(() => false)) {
        await overlay
          .getByRole("button", { name: new RegExp(dialogChoice) })
          .click()
          .catch(() => {});
        await expect(overlay)
          .toBeHidden({ timeout: 5000 })
          .catch(() => {});
      }
      await page.waitForTimeout(150);
    }
  })();
  try {
    // 落点按画布实际包围盒的相对比例计算：targetPosition 是 pane 相对坐标，
    // 两次拖拽需分离落点防 Schema 叠压（叠压会让上层节点的列约束区拦截
    // 对下层节点的点击，首次运行实证）
    const paneBox = (await canvas.boundingBox()) ?? {
      width: 1280,
      height: 720,
    };
    const dropPosition = {
      x: Math.round(paneBox.width * dropRatio.x),
      y: Math.round(paneBox.height * dropRatio.y),
    };
    await schemaItem
      .dragTo(canvas, { timeout: 15_000, targetPosition: dropPosition })
      .catch(() => {});
    await page.waitForTimeout(1000);
  } finally {
    dismissOverlay = false;
    await dismissTask.catch(() => {});
  }
}

/** base fixture 注入了隐藏 .custom-controls 的样式（防悬浮件吞点击），本 spec 需要操作它 */
async function showCanvasControls(page: Page) {
  await page.addStyleTag({
    content: ".custom-controls { display: flex !important; }",
  });
}

/**
 * 节点是否渲染在画布（hidden 节点 Vue Flow 不渲染，DOM 即可见集）。
 * 用 evaluate+querySelector 而非 page.locator().count()：实测水合/过滤重渲染
 * 窗口内两种引擎偶发不一致（locator 侧持续 0 而 querySelector 命中），
 * querySelector 口径在多次运行中稳定可靠。
 */
async function nodeVisible(page: Page, nodeId: string): Promise<boolean> {
  return page.evaluate(
    (id) => !!document.querySelector(`.vue-flow__node[data-id="${id}"]`),
    nodeId,
  );
}

/** 关闭检查器抽屉（夹具含校验违规，auto_validate 会拉起抽屉遮挡画布点击） */
async function closeInspectionDrawer(page: Page) {
  const drawer = page.locator(".inspection-drawer");
  if (await drawer.isVisible().catch(() => false)) {
    await drawer
      .locator('button[title="关闭"]')
      .first()
      .click({ timeout: 3000 })
      .catch(() => {});
    await expect(drawer)
      .toBeHidden({ timeout: 5000 })
      .catch(() => {});
  }
}

/**
 * 对指定 Schema 执行真实校验管线（validateAllConstraints → 后端 → 状态回写）。
 *
 * 为什么不经 Ctrl+Enter 快捷键触发：dev server 下 vue-devtools 的 inspector
 * 容器会占据 active pinia，键盘 handler 内的 useGraphStore() 解析到空 store
 * （实证：toast "请先选择节点" 而 store.selectedNodeId 已设置）。故在页面
 * 上下文里显式取主 app 的 pinia graph store，补上 requireSource 需要的
 * sourceFile（正常由数据源连线写入，V2 导入链路不设置），再调真实编排入口。
 */
async function validateSchemaViaPipeline(
  page: Page,
  schemaId: string,
  fileName: string,
) {
  await page.evaluate(
    async ([sid, fname]) => {
      const app = (
        document.querySelector("#app") as unknown as {
          __vue_app__?: {
            config: {
              globalProperties: { $pinia?: { _s?: Map<string, unknown> } };
            };
          };
        }
      )?.__vue_app__;
      const graph = app?.config.globalProperties.$pinia?._s?.get("graph") as {
        nodes: unknown[];
        edges: unknown[];
        updateNodeData: (id: string, data: Record<string, unknown>) => void;
      };
      if (!graph) throw new Error("graph store not reachable");
      graph.updateNodeData(sid as string, { sourceFile: fname });
      const mod =
        (await import("/src/services/constraints/orchestration/globalValidation.ts")) as {
          validateAllConstraints: (
            schemaNodeId: string,
            nodes: unknown[],
            edges: unknown[],
            updateNodeData: (id: string, data: Record<string, unknown>) => void,
          ) => Promise<unknown>;
        };
      await mod.validateAllConstraints(
        sid as string,
        graph.nodes,
        graph.edges,
        (id: string, data: Record<string, unknown>) =>
          graph.updateNodeData(id, data),
      );
    },
    [schemaId, fileName],
  );
}

test.describe("画布视图模式", () => {
  test("仅异常隐藏通过卡、聚焦隔离闭包、刷新后模式恢复", async ({
    projectPage,
    isolatedProjectPath,
    apiHelper,
  }) => {
    test.setTimeout(240_000);
    const page = projectPage;

    // 1. 夹具：两 Schema 三约束（每表 ≤ 3 卡，低于聚合阈值不建坞）
    writeFixture(isolatedProjectPath);

    // [CI-diag] 定位 CI-only 404（本地 Windows 绿、CI Linux 三轮全红）：
    // 三问——Node 侧文件在吗 / data 目录里有什么 / 后端直连（绕过 UI 与
    // Vite 代理）看得到吗。与请求载荷已核对：UI 发出的路径本身正确。
    {
      const dataDir = path.join(isolatedProjectPath, "data");
      const csv = path.join(dataDir, "vw_users.csv");
      console.log(
        `[CI-diag] writeFixture 后 existsSync(vw_users.csv)=${fs.existsSync(csv)}` +
          ` data目录=${fs.existsSync(dataDir) ? fs.readdirSync(dataDir).join(",") : "<不存在>"}`,
      );
      const probe = await apiHelper.post("/validate", {
        validation_type: "not_null",
        target_column_name: "name",
        source_file_path: csv,
        column_data_type: "String",
      });
      console.log(
        `[CI-diag] 直连后端探测 status=${probe.status} body=${(await probe.text()).slice(0, 160)}`,
      );
    }

    await openProjectOnCanvas(page, isolatedProjectPath);
    await showCanvasControls(page);

    // 2. 拖入两个 Schema（全部导入：schema + 物化约束卡；落点分离防叠压）
    await expect(async () => {
      await openResourceTree(page);
      await dragSchemaToCanvas(page, "vw_users", "全部导入", {
        x: 0.25,
        y: 0.5,
      });
      await expect(
        page.locator('.vue-flow__node-schema[data-id="vw_users"]'),
      ).toBeVisible({ timeout: 5000 });
    }).toPass({ timeout: 90_000 });
    await expect(async () => {
      await dragSchemaToCanvas(page, "vw_orders", "全部导入", {
        x: 0.7,
        y: 0.5,
      });
      await expect(
        page.locator('.vue-flow__node-schema[data-id="vw_orders"]'),
      ).toBeVisible({ timeout: 5000 });
    }).toPass({ timeout: 60_000 });

    // 三张卡 + 两个 Schema 全部可见（未建坞：卡片直接渲染）
    for (const id of [USERS_PASS_CARD, USERS_ERROR_CARD, ORDERS_PASS_CARD]) {
      await expect(
        page.locator(`.vue-flow__node[data-id="${id}"]`),
      ).toBeVisible({ timeout: 10_000 });
    }

    // 3. 校验：vw_users（name pass / age error）与 vw_orders（pass）
    // 状态类同时出现在节点根 div 与内部状态点上，用 .first() 避开 strict mode。
    // CI 慢环境下校验回写与节点 DOM 渐进入场/重建交叠，状态类可能瞬时缺席
    // （首跑两次 20s "element(s) not found"，本地同树绿）——用 toPass 整段重试
    // [CI-diag] 导入完成后复探：文件还在吗 + 直连后端结果（对比 T0 探针定位删除窗口）
    {
      const csv = path.join(isolatedProjectPath, "data", "vw_users.csv");
      console.log(`[CI-diag] 导入后 existsSync(vw_users.csv)=${fs.existsSync(csv)}`);
      const probe2 = await apiHelper.post("/validate", {
        validation_type: "not_null",
        target_column_name: "name",
        source_file_path: csv,
        column_data_type: "String",
      });
      console.log(
        `[CI-diag] 导入后直连探测 status=${probe2.status} body=${(await probe2.text()).slice(0, 160)}`,
      );
    }
    await validateSchemaViaPipeline(page, "vw_users", "vw_users.csv");
    await expect(async () => {
      await expect(
        page
          .locator(`.vue-flow__node[data-id="${USERS_ERROR_CARD}"] .status-error`)
          .first(),
      ).toBeVisible({ timeout: 10_000 });
      await expect(
        page
          .locator(`.vue-flow__node[data-id="${USERS_PASS_CARD}"] .status-pass`)
          .first(),
      ).toBeVisible({ timeout: 10_000 });
    }).toPass({ timeout: 60_000 });
    await validateSchemaViaPipeline(page, "vw_orders", "vw_orders.csv");
    await expect(async () => {
      await expect(
        page
          .locator(`.vue-flow__node[data-id="${ORDERS_PASS_CARD}"] .status-pass`)
          .first(),
      ).toBeVisible({ timeout: 10_000 });
    }).toPass({ timeout: 60_000 });

    // 4. 仅异常：pass 卡隐藏、error 卡保留、非约束节点不受影响
    await page.locator('[data-testid="view-mode-errors-only"]').click();
    await expect
      .poll(() => nodeVisible(page, USERS_PASS_CARD), { timeout: 10_000 })
      .toBe(false);
    await expect
      .poll(() => nodeVisible(page, ORDERS_PASS_CARD), { timeout: 10_000 })
      .toBe(false);
    // 可见断言同样用 poll：水合期模板实例仍在渐进入场，节点 DOM 有瞬时重建窗口
    await expect
      .poll(() => nodeVisible(page, USERS_ERROR_CARD), { timeout: 10_000 })
      .toBe(true);
    await expect
      .poll(() => nodeVisible(page, "vw_users"), { timeout: 10_000 })
      .toBe(true);
    await expect
      .poll(() => nodeVisible(page, "vw_orders"), { timeout: 10_000 })
      .toBe(true);
    await expect(
      page.locator('[data-testid="view-mode-errors-only"]'),
    ).toHaveAttribute("aria-pressed", "true");

    // 5. 聚焦：选中 vw_users → 仅保留其闭包（users + error 卡），orders 被隔离
    await closeInspectionDrawer(page);
    await page
      .locator('.vue-flow__node-schema[data-id="vw_users"]')
      .click({ timeout: 15_000 });
    await page.locator('[data-testid="view-mode-focus"]').click();
    await expect
      .poll(() => nodeVisible(page, "vw_orders"), { timeout: 10_000 })
      .toBe(false);
    await expect
      .poll(() => nodeVisible(page, "vw_users"), { timeout: 10_000 })
      .toBe(true);
    // 叠加语义：error 卡在闭包内且非 pass/idle，两个维度都保显
    await expect
      .poll(() => nodeVisible(page, USERS_ERROR_CARD), { timeout: 10_000 })
      .toBe(true);
    await expect(
      page.locator('[data-testid="view-mode-focus"]'),
    ).toHaveAttribute("aria-pressed", "true");

    // 6. 刷新恢复：保存视图 → reload → localStorage 分桶还原模式与过滤。
    // 注意：Ctrl+S 快捷键与 Ctrl+Enter 一样受 dev 环境 devtools pinia 劫持影响
    //（handler 内 useGraphStore() 解析到空 store），改走 store 真实 saveProject action。
    await page.evaluate(async () => {
      const app = (
        document.querySelector("#app") as unknown as {
          __vue_app__?: {
            config: {
              globalProperties: { $pinia?: { _s?: Map<string, unknown> } };
            };
          };
        }
      )?.__vue_app__;
      const graph = app?.config.globalProperties.$pinia?._s?.get("graph") as {
        nodes: unknown[];
        edges: unknown[];
        saveProject: () => Promise<unknown>;
      };
      if (!graph?.saveProject) throw new Error("saveProject not reachable");
      await graph.saveProject();
      // 多标签快照默认只在页面卸载（App.vue onUnmounted）时捕获，reload 的
      // unload 竞态会让 PUT workspaces 丢失 → 重开回空白画布。此处显式走
      // 与卸载路径相同的真实 store API 先落快照再刷新。
      const canvas = app?.config.globalProperties.$pinia?._s?.get("canvas") as {
        saveCurrentCanvasData: (nodes: unknown[], edges: unknown[]) => void;
        syncWorkspacesToBackend: () => Promise<void>;
      };
      if (!canvas) throw new Error("canvas store not reachable");
      canvas.saveCurrentCanvasData(graph.nodes, graph.edges);
      await canvas.syncWorkspacesToBackend();
    });
    await page.waitForTimeout(2000);
    await page.reload();
    await expect(page.locator(".project-root-node")).toBeVisible({
      timeout: 30_000,
    });
    await showCanvasControls(page);
    // 水合回显后过滤重新应用（防抖 watcher 收敛）。先等水合稳定（慢环境下
    // 节点渐进入场可达数十秒，直接轮询会出现"缺席=隐藏"的空洞通过）
    await waitForHydrationSettled(page, 1500);
    await expect
      .poll(() => nodeVisible(page, "vw_users"), { timeout: 60_000 })
      .toBe(true);
    await expect
      .poll(() => nodeVisible(page, "vw_orders"), { timeout: 30_000 })
      .toBe(false);
    // 工作区快照连同节点 data（含 validationStatus）一起恢复：pass 卡隐藏、
    // error 卡保持可见（快照里仍是 error，不是回退 idle）
    for (const cardId of [USERS_PASS_CARD, ORDERS_PASS_CARD]) {
      await expect
        .poll(() => nodeVisible(page, cardId), { timeout: 10_000 })
        .toBe(false);
    }
    await expect
      .poll(() => nodeVisible(page, USERS_ERROR_CARD), { timeout: 10_000 })
      .toBe(true);
    await expect(
      page.locator('[data-testid="view-mode-focus"]'),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.locator('[data-testid="view-mode-errors-only"]'),
    ).toHaveAttribute("aria-pressed", "true");

    // 7. 回全景 + 关仅异常：全部恢复可见
    await closeInspectionDrawer(page);
    await page.locator('[data-testid="view-mode-panorama"]').click();
    await page.locator('[data-testid="view-mode-errors-only"]').click();
    for (const id of [
      "vw_users",
      "vw_orders",
      USERS_PASS_CARD,
      USERS_ERROR_CARD,
      ORDERS_PASS_CARD,
    ]) {
      await expect
        .poll(() => nodeVisible(page, id), { timeout: 10_000 })
        .toBe(true);
    }
  });
});
