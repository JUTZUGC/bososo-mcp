#!/usr/bin/env node
// 博搜搜 MCP server（零依赖，stdio + 换行分隔的 JSON-RPC 2.0）
//
// 暴露两个工具给 AI 客户端：
//   bososo_search        关键词搜索，返回带 token 的结果列表
//   bososo_get_resource  用 token 换取可保存的分享链接
//
// 接入手册见 README.md。
// ⚠️ stdout 只允许出现 JSON-RPC 消息（客户端按行解析），任何日志都必须走 stderr。

import { createClient, BososoError, VERSION } from "./lib/bososo.mjs";

// 版本号唯一来源是 package.json（见 lib/bososo.mjs 的 VERSION），这里不再单独写死
const SERVER_INFO = { name: "bososo", version: VERSION };
// 客户端与服务端只用到 initialize / tools/list / tools/call，这个版本足够
const PROTOCOL_VERSION = "2024-11-05";

const TOOLS = [
  {
    name: "bososo_search",
    description:
      "按关键词搜索网盘资源（夸克/UC/百度/迅雷等），返回带 token 的结果列表。这是获取资源的第 1 步；" +
      "要用 bososo_get_resource 取回可保存的分享链接，必须使用本工具返回的 token。" +
      "注意：搜索需要一点时间把结果找全（通常 20~40 秒），本工具会等到结果齐了再返回，" +
      "耗时较长属正常，不要因为慢就重复调用。",
    inputSchema: {
      type: "object",
      properties: {
        keyword: { type: "string", description: "搜索关键词（必填，上限 200 字符）" },
        page: { type: "integer", minimum: 1, description: "页码，默认 1" },
        pageSize: { type: "integer", minimum: 1, maximum: 50, description: "每页条数，默认 20，上限 50" },
        matchMode: {
          type: "string",
          enum: ["fuzzy", "precise"],
          description: "fuzzy（默认）匹配标题+正文；precise 只匹配标题，结果更准但更少",
        },
        cloudTypes: {
          type: "array",
          items: { type: "string", enum: ["quark", "uc", "baidu", "xunlei", "guangyapan"] },
          description: "只要指定网盘平台的结果；不传 = 不限",
        },
        timeRangeDays: { type: "integer", minimum: 0, description: "只取最近 N 天的结果；0 或不传 = 不限" },
        maxResults: { type: "integer", minimum: 1, maximum: 500, description: "结果上限；不传由服务端决定" },
        refresh: { type: "boolean", description: "true = 忽略服务端缓存重新检索；一般不需要" },
        waitSeconds: { type: "integer", minimum: 5, maximum: 300, description: "等待结果找全的最长秒数，默认 120" },
      },
      required: ["keyword"],
    },
  },
  {
    name: "bososo_get_resource",
    description:
      "用 bososo_search 返回的 token 换取一份可保存的分享链接。" +
      "这是获取资源的第 2 步，token 只能来自 bososo_search 的结果，不能自行构造。" +
      "该操作服务端要真实处理一次、耗时较长；短时间内请求过多时会被要求先完成一次安全验证" +
      "（返回 CAPTCHA_REQUIRED）—— 这种情况只能由用户在浏览器里手动完成验证，不要反复重试。",
    inputSchema: {
      type: "object",
      properties: {
        token: { type: "string", description: "bososo_search 结果项里的 token（必填）" },
        waitSeconds: { type: "integer", minimum: 5, maximum: 180, description: "允许等待/重试的最长秒数，默认 90" },
      },
      required: ["token"],
    },
  },
];

const client = createClient();

/** 工具统一返回：成功给紧凑 JSON，失败打 isError 并附上可操作建议 */
const okResult = (obj) => ({ content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] });
const errResult = (obj) => ({ content: [{ type: "text", text: JSON.stringify(obj, null, 2) }], isError: true });

async function callTool(name, args = {}) {
  if (name === "bososo_search") {
    const r = await client.search({
      kw: args.keyword,
      page: args.page,
      pageSize: args.pageSize,
      matchMode: args.matchMode,
      cloudTypes: args.cloudTypes,
      timeRangeDays: args.timeRangeDays,
      maxResults: args.maxResults,
      refresh: args.refresh,
      waitMs: Number(args.waitSeconds) > 0 ? Number(args.waitSeconds) * 1000 : undefined,
    });
    // 只回传模型真正要用的字段：token 必须完整（下一步要用），其余去掉以省上下文
    return okResult({
      keyword: args.keyword,
      total: r.total,
      page: r.page,
      maxPage: r.maxPage,
      incomplete: r.incomplete,
      tookMs: r.took,
      waitedMs: r.waitedMs,
      serverNote: r.note || "",
      resultCount: r.results.length,
      results: r.results.map((it, i) => ({
        n: i + 1,
        title: it.title,
        platform: it.course || it.platform,
        datetime: it.datetime || "",
        token: it.token,
      })),
      nextStep: r.results.length
        ? "用 bososo_get_resource 传某个结果的 token，即可拿到可保存的分享链接。"
        : "没有结果，可换关键词或放宽过滤条件。",
    });
  }

  if (name === "bososo_get_resource") {
    const r = await client.getResource(args.token, {
      waitMs: Number(args.waitSeconds) > 0 ? Number(args.waitSeconds) * 1000 : undefined,
    });
    return okResult({
      ok: true,
      shareUrl: r.shareUrl,
      sharePassword: r.sharePassword,
      reused: r.reused,
      note: r.reused ? "这条资源此前已经获取过，本次直接返回了已有结果。" : "",
    });
  }

  return errResult({ ok: false, code: "UNKNOWN_TOOL", error: `未知工具：${name}` });
}

/** 处理一条 JSON-RPC 请求；返回 null 表示这是通知，不需要响应 */
async function handle(msg) {
  const { id, method, params } = msg || {};
  const isNotification = id === undefined || id === null;

  try {
    switch (method) {
      case "initialize":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: params?.protocolVersion || PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: SERVER_INFO,
          },
        };

      case "notifications/initialized":
      case "notifications/cancelled":
        return null;

      case "ping":
        return { jsonrpc: "2.0", id, result: {} };

      case "tools/list":
        return { jsonrpc: "2.0", id, result: { tools: TOOLS } };

      case "tools/call": {
        const name = params?.name;
        const args = params?.arguments || {};
        try {
          const result = await callTool(name, args);
          return { jsonrpc: "2.0", id, result };
        } catch (e) {
          // 业务/网络失败都按「工具执行失败」返回，让模型看到 code 与建议，而不是断掉连接
          const payload = e instanceof BososoError
            ? e.toJSON()
            : { ok: false, code: "UNEXPECTED", error: e?.message || String(e) };
          if (!(e instanceof BososoError)) console.error("[bososo-mcp] 工具异常:", e?.stack || e);
          return { jsonrpc: "2.0", id, result: errResult(payload) };
        }
      }

      default:
        if (isNotification) return null;
        return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
    }
  } catch (e) {
    console.error("[bososo-mcp] 处理失败:", e?.stack || e);
    if (isNotification) return null;
    return { jsonrpc: "2.0", id, error: { code: -32603, message: e?.message || "Internal error" } };
  }
}

function write(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

let buffer = "";
// 正在处理中的请求数 + stdin 是否已关闭：两者都满足才退出。
// 为什么不直接在 stdin 的 end 事件里 process.exit(0)：README 里给了一条
// `printf ... | node mcp-server.mjs` 的手动验证命令 —— 那种用法下 stdin 会立刻关闭，
// 若此时响应还没写出去，直接退出就会把结果截掉（表现为「什么都没输出」）。
let inFlight = 0;
let stdinClosed = false;
const exitIfDrained = () => {
  if (stdinClosed && inFlight === 0) process.exit(0);
};

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  for (;;) {
    const nl = buffer.indexOf("\n");
    if (nl < 0) break;
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;

    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      console.error(`[bososo-mcp] 收到非 JSON 行，已忽略：${line.slice(0, 200)}`);
      continue;
    }
    // 不 await：一条请求的处理（搜索可能几十秒）不该阻塞后续消息的读取
    inFlight++;
    handle(msg)
      .then((res) => {
        if (res) write(res);
      })
      .catch((e) => {
        console.error("[bososo-mcp] 未捕获:", e?.stack || e);
        if (msg?.id !== undefined && msg?.id !== null) {
          write({ jsonrpc: "2.0", id: msg.id, error: { code: -32603, message: e?.message || "Internal error" } });
        }
      })
      .finally(() => {
        inFlight--;
        exitIfDrained();
      });
  }
});

process.stdin.on("end", () => {
  stdinClosed = true;
  exitIfDrained();
});
console.error(`[bososo-mcp] 已启动：base=${client.baseUrl}，工具 ${TOOLS.map((t) => t.name).join(" / ")}`);
