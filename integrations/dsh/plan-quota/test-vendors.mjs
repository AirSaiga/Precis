// 冒烟测试：验证 dsh-plan-quota 使用的三个厂商端点连通性与响应结构。
// 只读取本机凭据文件，只打印额度摘要 —— 绝不输出密钥本身。
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

// 解析 ~/.dsh/.credentials.yaml 的 refs: 段（KEY: value 平铺）；进程环境优先（与 credentials-local 分层一致）
function refValue(name) {
  if (process.env[name]) return process.env[name];
  try {
    const text = readFileSync(homedir() + "/.dsh/.credentials.yaml", "utf8");
    let inRefs = false;
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      if (/^[A-Za-z]/.test(line) && line === t) {
        inRefs = t === "refs:";
        continue;
      }
      if (!inRefs) continue;
      const m = t.match(/^([A-Z_][A-Z0-9_]*):\s*(.+)$/);
      if (m && m[1] === name) return m[2].replace(/^["']|["']$/g, "").trim();
    }
  } catch { /* 文件缺失 */ }
  return null;
}

const mask = (k) => (k ? k.slice(0, 6) + "..." + k.slice(-4) + ` (len=${k.length})` : "MISSING");
const num = (v) => (typeof v === "number" ? v : parseFloat(v));

async function fetchJson(url, headers) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  const text = await res.text();
  if (!res.ok) throw new Error("HTTP " + res.status + " " + text.slice(0, 150));
  return JSON.parse(text);
}

const results = [];

// 1) Kimi For Coding
{
  const key = refValue("KIMI_CODING_API_KEY") || refValue("KIMI_API_KEY");
  if (!key) {
    results.push(["kimi", "SKIP", "凭据未配置"]);
  } else {
    try {
      const body = await fetchJson("https://api.kimi.com/coding/v1/usages", {
        authorization: "Bearer " + key,
        accept: "application/json",
      });
      const out = { tiers: [] };
      for (const item of body.limits || []) {
        const d = item?.detail;
        if (d && num(d.limit) > 0) {
          out.tiers.push("5h剩" + Math.round((num(d.remaining) / num(d.limit)) * 100) + "% (reset " + (d.resetTime || "?") + ")");
          break;
        }
      }
      if (body.usage && num(body.usage.limit) > 0) {
        out.tiers.push("总剩" + Math.round((num(body.usage.remaining) / num(body.usage.limit)) * 100) + "%");
      }
      out.membership = body.user?.membership?.level || null;
      results.push(["kimi", "OK", JSON.stringify(out)]);
    } catch (e) {
      results.push(["kimi", "FAIL", e.message]);
    }
  }
}

// 2) GLM Coding Plan (CN)
{
  const key = refValue("ZAI_CODING_CN_API_KEY") || refValue("ZAI_CODING_API_KEY") || refValue("ZAI_API_KEY") || refValue("ZHIPU_API_KEY");
  if (!key) {
    results.push(["zai", "SKIP", "凭据未配置"]);
  } else {
    try {
      const body = await fetchJson("https://open.bigmodel.cn/api/monitor/usage/quota/limit", {
        authorization: key, // bigmodel.cn monitor 端点用裸 key
        accept: "application/json",
      });
      const limits = body.data?.limits || [];
      const out = { limits: limits.length, tiers: [] };
      for (const item of limits) {
        const type = String(item.type || item.name || "").toUpperCase();
        if (type !== "TOKENS_LIMIT" && type !== "CREDIT_LIMIT") continue;
        out.tiers.push(type + " unit=" + item.unit + " used%=" + item.percentage + " reset=" + (item.nextResetTime || "?"));
      }
      results.push(["zai", "OK", JSON.stringify(out)]);
    } catch (e) {
      results.push(["zai", "FAIL", e.message]);
    }
    try {
      const sub = await fetchJson("https://open.bigmodel.cn/api/biz/subscription/list", {
        authorization: key,
        accept: "application/json",
      });
      results.push(["zai-sub", "OK", JSON.stringify(sub?.data?.[0] || sub)]);
    } catch (e) {
      results.push(["zai-sub", "FAIL(best-effort)", e.message]);
    }
  }
}

// 3) DeepSeek 余额
{
  const key = refValue("DEEPSEEK_API_KEY");
  if (!key) {
    results.push(["deepseek", "SKIP", "凭据未配置"]);
  } else {
    try {
      const body = await fetchJson("https://api.deepseek.com/user/balance", {
        authorization: "Bearer " + key,
        accept: "application/json",
      });
      const info = (body.balance_infos || [])[0];
      results.push(["deepseek", "OK", JSON.stringify({ available: body.is_available, currency: info?.currency, total: info?.total_balance })]);
    } catch (e) {
      results.push(["deepseek", "FAIL", e.message]);
    }
  }
}

console.log("=== plan-quota 厂商端点冒烟测试 ===");
for (const [name, status, detail] of results) console.log(`${name.padEnd(10)} ${status.padEnd(18)} ${detail}`);
