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
 * @fileoverview 首开布局 E2E —— 快照存在但 view.json 无坐标时，水合 fallback 网格节点被加载适配自动整理为 Schema 中心化布局
 *
 * 夹具复现"首开乱局"触发条件：
 * - .precis/workspaces.json 存在但节点为空（lastLoadHadSavedWorkspaces=true →
 *   走水合补齐；实体全部为"本次新建"）
 * - 无 project.view.json（无保存坐标 → 全部落入 fallback 双尺寸网格）
 * - 两 Schema：fo_users 含两条内嵌约束（物化卡片），fo_orders 由一条独立
 *   约束文件关联（两条物化路径都覆盖）
 *
 * 断言（加载适配消费 fallback 登记并跑 Schema 中心化布局后）：
 * 1. 每条 Schema↔约束边：约束节点落在其 Schema 右侧（x 更大）且垂直距离
 *    在合理 slack 内（fallback 网格下约束整排沉在 schema 区块下方 ≥880px，
 *    与关系布局的可分辨区间无交集）
 * 2. 任意两节点 DOM 包围盒不重叠（关系布局质量守卫）
 */
import { test, expect } from "../fixtures/base";
import { openProjectOnCanvas, waitForHydrationSettled } from "../fixtures/openProject";
import * as fs from "fs";
import * as path from "path";

type Page = import("@playwright/test").Page;

const FO_USERS_SCHEMA = `version: 2
id: fo_users
name: fo_users
description: 首开布局夹具：用户表（内嵌 NotNull + Range 两条约束）
source:
  mode: relative_file
  path: data/fo_users.csv
columns:
  - {id: id, name: id, type: string}
  - {id: name, name: name, type: string}
  - {id: age, name: age, type: integer}
constraints:
  - id: fo_name_notnull
    type: NotNull
    column: name
  - id: fo_age_range
    type: Range
    column: age
    params: {min: 0, max: 120, boundary_mode: inclusive}
`;

const FO_USERS_CSV = `id,name,age
u1,alice,30
u2,bob,150
`;

const FO_ORDERS_SCHEMA = `version: 2
id: fo_orders
name: fo_orders
description: 首开布局夹具：订单表（独立约束文件关联）
source:
  mode: relative_file
  path: data/fo_orders.csv
columns:
  - {id: order_id, name: order_id, type: string}
  - {id: amount, name: amount, type: float}
`;

const FO_ORDERS_CSV = `order_id,amount
A1,10.5
A2,20.0
`;

const FO_ORDERS_AMOUNT_RANGE = `version: 2
id: fo_orders_amount_range
type: Range
enabled: true
description: 订单金额必须在 0 - 100000 之间
refs:
  table_id: fo_orders
  column_id: amount
params:
  min: 0
  max: 100000
  boundary_mode: inclusive
`;

/** 最小清单：两 Schema + 一条独立约束，避免整包 qa_simple 实体拖慢水合 */
const MINIMAL_MANIFEST = `version: 2
project:
  id: fo_layout
  name: 首开布局夹具工程
settings:
  validation:
    auto_validate: false
    strict_mode: false
    error_handling: continue
    timeout_seconds: 30
schemas:
- id: fo_users
  path: schemas/fo_users.schema.yaml
- id: fo_orders
  path: schemas/fo_orders.schema.yaml
constraints:
- id: fo_orders_amount_range
  path: constraints/fo_orders_amount_range.constraint.yaml
data_sources:
- id: primary
  path: data
  mode: relative
`;

/**
 * 空快照 workspaces.json：触发 lastLoadHadSavedWorkspaces=true（水合门控），
 * 但不含任何实体节点（所有实体均按 fallback 网格新建）。
 */
const EMPTY_WORKSPACES = `{
  "version": 1,
  "activeWorkspaceId": "fo-layout-ws-0001",
  "workspaces": [
    {
      "id": "fo-layout-ws-0001",
      "title": "工作区 1",
      "index": 1,
      "createdAt": "2026-09-01T00:00:00.000Z",
      "lastActiveAt": "2026-09-01T00:00:00.000Z",
      "visibleNodeIds": [],
      "viewport": null,
      "nodes": [],
      "edges": []
    }
  ]
}
`;

/** 期望的 Schema ↔ 约束配对（内嵌物化卡片 id 约定：{schemaId}_{constraintId}） */
const EXPECTED_PAIRS: ReadonlyArray<{ schemaId: string; constraintId: string }> = [
  { schemaId: "fo_users", constraintId: "fo_users_fo_name_notnull" },
  { schemaId: "fo_users", constraintId: "fo_users_fo_age_range" },
  { schemaId: "fo_orders", constraintId: "fo_orders_amount_range" },
];

/** 约束相对 Schema 的垂直距离 slack：关系布局 ≤ ~400px，fallback 网格 ≥880px */
const VERTICAL_SLACK = 700;

function writeFixture(isolatedProjectPath: string) {
  fs.writeFileSync(
    path.join(isolatedProjectPath, "schemas", "fo_users.schema.yaml"),
    FO_USERS_SCHEMA,
  );
  fs.writeFileSync(
    path.join(isolatedProjectPath, "schemas", "fo_orders.schema.yaml"),
    FO_ORDERS_SCHEMA,
  );
  fs.writeFileSync(
    path.join(isolatedProjectPath, "constraints", "fo_orders_amount_range.constraint.yaml"),
    FO_ORDERS_AMOUNT_RANGE,
  );
  fs.writeFileSync(
    path.join(isolatedProjectPath, "data", "fo_users.csv"),
    FO_USERS_CSV,
  );
  fs.writeFileSync(
    path.join(isolatedProjectPath, "data", "fo_orders.csv"),
    FO_ORDERS_CSV,
  );
  fs.writeFileSync(
    path.join(isolatedProjectPath, "project.precis.yaml"),
    MINIMAL_MANIFEST,
  );
  fs.mkdirSync(path.join(isolatedProjectPath, ".precis"), { recursive: true });
  fs.writeFileSync(
    path.join(isolatedProjectPath, ".precis", "workspaces.json"),
    EMPTY_WORKSPACES,
  );
}

type CanvasSnapshot = {
  nodes: Array<{ id: string; type?: string; position: { x: number; y: number } }>;
  edges: Array<{ source: string; target: string }>;
};

/** 经主应用 pinia 读 graph store 的节点位置（画布坐标）与边 */
async function readCanvas(page: Page): Promise<CanvasSnapshot> {
  return page.evaluate(() => {
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
      nodes: CanvasSnapshot["nodes"];
      edges: CanvasSnapshot["edges"];
    };
    if (!graph) throw new Error("graph store not reachable");
    return {
      nodes: graph.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        position: { x: n.position.x, y: n.position.y },
      })),
      edges: graph.edges.map((e) => ({ source: e.source, target: e.target })),
    };
  });
}

/**
 * 布局断言违例收集：
 * - 期望配对必须有真实连线（无连线说明夹具/水合路径断裂，直接失败）
 * - 约束必须在 Schema 右侧且垂直距离 ≤ VERTICAL_SLACK
 */
function collectLayoutViolations(
  snapshot: CanvasSnapshot,
): string[] {
  const violations: string[] = [];
  const posById = new Map(snapshot.nodes.map((n) => [n.id, n.position]));
  const edgeKeys = new Set(
    snapshot.edges.flatMap((e) => [`${e.source}->${e.target}`, `${e.target}->${e.source}`]),
  );

  for (const { schemaId, constraintId } of EXPECTED_PAIRS) {
    const schemaPos = posById.get(schemaId);
    const constraintPos = posById.get(constraintId);
    if (!schemaPos) {
      violations.push(`Schema 节点缺失: ${schemaId}`);
      continue;
    }
    if (!constraintPos) {
      violations.push(`约束节点缺失: ${constraintId}`);
      continue;
    }
    if (!edgeKeys.has(`${schemaId}->${constraintId}`)) {
      violations.push(`缺少连线: ${schemaId} ↔ ${constraintId}`);
      continue;
    }
    if (constraintPos.x <= schemaPos.x) {
      violations.push(
        `约束 ${constraintId} (x=${constraintPos.x}) 未落在 Schema ${schemaId} (x=${schemaPos.x}) 右侧`,
      );
    }
    const dy = Math.abs(constraintPos.y - schemaPos.y);
    if (dy > VERTICAL_SLACK) {
      violations.push(
        `约束 ${constraintId} 距 Schema ${schemaId} 垂直距离 ${dy}px 超出 slack ${VERTICAL_SLACK}px`,
      );
    }
  }
  return violations;
}

/**
 * DOM 包围盒两两重叠检测。getBoundingClientRect 受视口缩放影响，但重叠
 * 判定对等比缩放平移不变，无需换算回画布坐标。2px 容差吸收边框/亚像素残差。
 */
async function collectOverlapViolations(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const rects = Array.from(document.querySelectorAll(".vue-flow__node")).map((el) => ({
      id: (el as HTMLElement).dataset.id ?? "?",
      r: el.getBoundingClientRect(),
    }));
    const violations: string[] = [];
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i].r;
        const b = rects[j].r;
        const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (overlapX > 2 && overlapY > 2) {
          violations.push(
            `${rects[i].id} 与 ${rects[j].id} 包围盒重叠 (${overlapX.toFixed(0)}x${overlapY.toFixed(0)})`,
          );
        }
      }
    }
    return violations;
  });
}

test.describe("项目首开画布布局", () => {
  test("快照存在、view 无坐标时水合 fallback 节点自动整理为 Schema 中心化布局", async ({
    projectPage,
    isolatedProjectPath,
  }) => {
    test.setTimeout(240_000);
    const page = projectPage;

    // 1. 夹具：空快照 workspaces.json（触发水合门控）+ 无 view.json（全 fallback 网格）
    writeFixture(isolatedProjectPath);

    // 2. 打开项目并等水合稳定；加载适配在 markContentLoaded 后防抖执行，
    //    布局断言用 poll 等待重排落地（防抖 160ms + 硬上限 2.5s + 渲染）
    await openProjectOnCanvas(page, isolatedProjectPath);
    await waitForHydrationSettled(page);

    const expectedIds = [
      ...EXPECTED_PAIRS.map((p) => p.schemaId),
      ...EXPECTED_PAIRS.map((p) => p.constraintId),
    ];
    await expect
      .poll(
        async () => {
          const snapshot = await readCanvas(page);
          const present = new Set(snapshot.nodes.map((n) => n.id));
          return expectedIds.filter((id) => !present.has(id));
        },
        { timeout: 60_000 },
      )
      .toEqual([]);

    // 3. 关系布局断言：约束在所属 Schema 右侧且垂直贴近
    await expect
      .poll(async () => collectLayoutViolations(await readCanvas(page)), {
        timeout: 30_000,
      })
      .toEqual([]);

    // 4. 布局稳定后做包围盒重叠守卫（给渐进入场动画留收敛窗口）
    await page.waitForTimeout(500);
    const overlaps = await collectOverlapViolations(page);
    expect(overlaps, `节点包围盒不应重叠: ${overlaps.join("; ")}`).toEqual([]);
  });
});
