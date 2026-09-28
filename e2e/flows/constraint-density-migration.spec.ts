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
 * @fileoverview 坞退役迁移 E2E —— 加载时净化旧持久化状态
 *
 * 场景：手写含坞时代残留的持久化文件模拟旧项目，验证 sanitizeRestoredCanvas
 * 在两条恢复路径的接入效果：
 * 1. 工作区快照（.precis/workspaces.json）残留：constraintDock 空壳节点、
 *    dock-edge-* 展示边（含 data.kind 副本）、孤儿边、聚合残留 hidden 的
 *    约束卡、模板折叠子节点（parentNode，hidden 必须保留）
 * 2. view.json 写侧：密度时代保存不再产生约束卡 hidden:true 死键
 */
import { test, expect } from "../fixtures/base";
import { openProjectOnCanvas } from "../fixtures/openProject";
import * as fs from "fs";
import * as path from "path";
import {
  CUSTOMERS_SCHEMA,
  INDEPENDENT_TEMPLATE,
  openResourceTree,
  dragSchemaToCanvas,
} from "../fixtures/densityFixture";

type Page = import("@playwright/test").Page;

/** 读取画布 store 的节点/边摘要（断言面） */
async function readCanvasState(page: Page) {
  return page.evaluate(() => {
    const app = (
      document.querySelector("#app") as unknown as { __vue_app__?: unknown }
    )?.__vue_app__;
    const pinia = (
      app as {
        config: {
          globalProperties: { $pinia?: { _s?: Map<string, unknown> } };
        };
      }
    )?.config.globalProperties?.$pinia;
    for (const [, s] of pinia?._s ?? []) {
      const store = s as {
        nodes?: Array<{ id: string; type?: string; hidden?: boolean }>;
        edges?: Array<{ id: string; source: string; target: string }>;
      };
      if (Array.isArray(store.nodes) && Array.isArray(store.edges)) {
        return {
          nodes: store.nodes.map((n) => ({
            id: n.id,
            type: n.type ?? "",
            hidden: n.hidden === true,
          })),
          edges: store.edges.map((e) => ({
            id: e.id,
            source: e.source,
            target: e.target,
          })),
        };
      }
    }
    return null;
  });
}

test.describe("坞退役迁移：加载时净化", () => {
  test("工作区快照残留（坞壳/展示边/孤儿边/聚合 hidden）打开即净化", async ({
    projectPage,
    isolatedProjectPath,
  }) => {
    test.setTimeout(180_000);
    const page = projectPage;

    // 手写 .precis/workspaces.json 模拟旧项目快照（syncTabsToBackend 的 payload 格式）
    const usersSchemaNode = {
      id: "users",
      type: "schema",
      position: { x: 200, y: 200 },
      data: {
        configName: "users",
        tableName: "users",
        saveState: "saved",
        columns: [{ id: "email", columnName: "email", dataType: "string" }],
      },
    };
    const constraintCard = (
      id: string,
      extra: Record<string, unknown> = {},
    ) => ({
      id,
      type: "notNullConstraint",
      position: { x: 640, y: 220 },
      ...extra,
      data: {
        configName: `C_${id}`,
        saveState: "saved",
        sourceRef: { nodeId: "users", columnId: "email" },
      },
    });
    const workspaceId = "ws-legacy";
    const payload = {
      version: 1,
      activeWorkspaceId: workspaceId,
      workspaces: [
        {
          id: workspaceId,
          title: "旧会话",
          index: 0,
          createdAt: "2026-09-01T00:00:00.000Z",
          lastActiveAt: "2026-09-01T00:00:00.000Z",
          visibleNodeIds: [],
          nodes: [
            {
              id: "project-root",
              type: "projectRoot",
              position: { x: 0, y: 0 },
              draggable: false,
              data: { projectName: "qa", projectPath: "", configPath: "" },
            },
            usersSchemaNode,
            // 聚合残留 hidden 的约束卡（坞时代 dockSync 所为）——净化后必须可见
            constraintCard("users_not_null_email", { hidden: true }),
            constraintCard("users_unique_email", { hidden: true }),
            // 模板折叠子节点（parentNode 非空）——hidden 必须保留
            {
              ...constraintCard("tpl_inner_c1", {
                hidden: true,
                parentNode: "tpl-1",
              }),
              type: "uniqueConstraint",
            },
            {
              id: "tpl-1",
              type: "templateInstance",
              position: { x: 900, y: 400 },
              data: {},
            },
            // 已注销类型的空壳坞节点——必须剔除
            {
              id: "constraint-dock-users",
              type: "constraintDock",
              position: { x: 620, y: 200 },
              data: {
                schemaNodeId: "users",
                rows: [],
                expanded: false,
                expandedAll: false,
              },
            },
          ],
          edges: [
            // 坞展示边（id 前缀判）
            {
              id: "dock-edge-users-email",
              source: "users",
              target: "constraint-dock-users",
              sourceHandle: "source-right-email",
            },
            // 坞展示边（data.kind 判，虚拟锚点 proxy 副本形态）
            {
              id: "legacy-va-proxy",
              source: "users",
              target: "constraint-dock-users",
              data: { kind: "dockDisplay", transient: true },
            },
            // 正常约束边——保留
            {
              id: "e-users-users_not_null_email",
              source: "users",
              target: "users_not_null_email",
            },
            // 孤儿边（target 不存在）——剔除
            { id: "e-orphan", source: "users", target: "ghost-node" },
          ],
        },
      ],
    };
    const precisDir = path.join(isolatedProjectPath, ".precis");
    fs.mkdirSync(precisDir, { recursive: true });
    fs.writeFileSync(
      path.join(precisDir, "workspaces.json"),
      JSON.stringify(payload),
    );

    // 打开项目：启动时 canvasStore.initialize 走快照恢复分支（净化在此收敛）
    await openProjectOnCanvas(page, isolatedProjectPath);
    await page.waitForTimeout(2000);

    // DOM 断言：无 constraintDock 空壳；聚合残留卡可见（hidden 不渲染 → 出现在 DOM 即可见）
    await expect(
      page.locator('.vue-flow__node-schema[data-id="users"]'),
    ).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator('[data-id^="constraint-dock-"]')).toHaveCount(0);
    await expect(
      page.locator('.vue-flow__node[data-id="users_not_null_email"]'),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.locator('.vue-flow__node[data-id="users_unique_email"]'),
    ).toBeVisible();
    // 模板折叠子节点保持隐藏（不在 DOM）
    await expect(
      page.locator('.vue-flow__node[data-id="tpl_inner_c1"]'),
    ).toHaveCount(0);
    // 坞展示边不在 DOM（启动水合会追加 manifest 实体边，故只做定向断言而非全局计数）
    // 注：Vue Flow 边元素的 id 属性为 data-id 或 data-flowid（版本差异），evaluate 双判
    const domEdgeIds = await page.$$eval(".vue-flow__edge", (els) =>
      els.map(
        (e) => e.getAttribute("data-flowid") || e.getAttribute("data-id") || "",
      ),
    );
    expect(domEdgeIds.some((id) => id.startsWith("dock-edge-"))).toBe(false);
    expect(domEdgeIds).not.toContain("legacy-va-proxy");
    // 正常约束边保留渲染
    // 快照的正常边会被随后的启动水合（DEF-01）按规范 id 重建（既有产品行为，
    // 与本迁移无关），DOM 边不断言具体 id；净化语义由下方 store 定向断言覆盖

    // store 断言：净化审计（定向——追加水合的边不在此列）
    const state = await readCanvasState(page);
    expect(state).not.toBeNull();
    expect(state!.nodes.some((n) => n.type === "constraintDock")).toBe(false);
    expect(
      state!.nodes.find((n) => n.id === "users_not_null_email")!.hidden,
    ).toBe(false);
    expect(
      state!.nodes.find((n) => n.id === "users_unique_email")!.hidden,
    ).toBe(false);
    expect(state!.nodes.find((n) => n.id === "tpl_inner_c1")!.hidden).toBe(
      true,
    );
    const edgeIds = state!.edges.map((e) => e.id);
    expect(edgeIds.some((id) => id.startsWith("dock-edge-"))).toBe(false);
    expect(edgeIds).not.toContain("legacy-va-proxy");
    expect(edgeIds).not.toContain("e-orphan");
    // 快照恢复确凿证据：manifest 外的假 templateInstance 及其折叠子节点在画布
    expect(state!.nodes.some((n) => n.id === "tpl-1")).toBe(true);
  });

  test("密度时代保存：view.json 不再产生约束卡 hidden 死键", async ({
    projectPage,
    isolatedProjectPath,
  }) => {
    test.setTimeout(240_000);
    const page = projectPage;

    // 复用 density fixture：14 列 + 24 卡（> 阈值 → 紧凑条但全部可见）
    fs.writeFileSync(
      path.join(isolatedProjectPath, "schemas", "customers.schema.yaml"),
      CUSTOMERS_SCHEMA,
    );
    fs.writeFileSync(
      path.join(
        isolatedProjectPath,
        "constraints",
        "cust2_email_fmt.constraint.yaml",
      ),
      INDEPENDENT_TEMPLATE("cust2_email_fmt", "email", "客户邮箱格式检查"),
    );
    fs.writeFileSync(
      path.join(
        isolatedProjectPath,
        "constraints",
        "cust2_phone_len.constraint.yaml",
      ),
      INDEPENDENT_TEMPLATE("cust2_phone_len", "phone", "客户手机号长度检查"),
    );
    const manifestPath = path.join(isolatedProjectPath, "project.precis.yaml");
    const manifest = fs.readFileSync(manifestPath, "utf-8");
    fs.writeFileSync(
      manifestPath,
      manifest.replace(
        "constraints:\n",
        `constraints:\n- id: cust2_email_fmt\n  path: constraints/cust2_email_fmt.constraint.yaml\n- id: cust2_phone_len\n  path: constraints/cust2_phone_len.constraint.yaml\n`,
      ),
    );

    await openProjectOnCanvas(page, isolatedProjectPath);
    await expect(async () => {
      await openResourceTree(page);
      await dragSchemaToCanvas(page, "customers", "全部导入");
      await expect(
        page.locator('.vue-flow__node-schema[data-id="customers"]'),
      ).toBeVisible({ timeout: 5000 });
    }).toPass({ timeout: 90_000 });
    // 清导入自动选中 → 等密度收敛（24 条紧凑条全部可见）
    await page.locator(".vue-flow__pane").click({ position: { x: 5, y: 5 } });
    await expect
      .poll(async () => await page.locator(".constraint-compact-bar").count(), {
        timeout: 15_000,
      })
      .toBe(24);

    // 保存（Ctrl+S 写 view.json）
    await page.keyboard.press("Control+s");
    await page.waitForTimeout(2500);

    const viewPath = path.join(isolatedProjectPath, "project.view.json");
    const viewRaw = fs.existsSync(viewPath)
      ? fs.readFileSync(viewPath, "utf-8")
      : "";
    // 写侧无坞死键 / 无约束卡 hidden:true（密度时代卡片可见，hidden 不写入）
    expect(viewRaw).not.toContain("constraint-dock-");
    expect(viewRaw).not.toContain("dock-edge-");
    expect(viewRaw).not.toContain('"hidden": true');
    expect(viewRaw).not.toContain('"hidden":true');
  });
});
