#!/usr/bin/env node
// 博搜搜命令行工具（零依赖）
//
//   node cli.mjs search "囧次元" [选项]
//   node cli.mjs get "<token>" [选项]
//
// 机器可读输出用 --json（CLI 与 MCP server 共用 lib/bososo.mjs，行为一致）。
// 退出码：0 成功 / 1 业务失败（需要安全验证、请求过多、资源取不到…）/ 2 用法错误

import { createClient, BososoError } from "./lib/bososo.mjs";
import { checkHost, HOST_BLOCKED } from "./lib/hostCheck.mjs";

const USAGE = `博搜搜命令行工具

用法：
  node cli.mjs search <关键词> [选项]
  node cli.mjs get <token> [选项]

search 选项：
  --page <N>            页码，默认 1
  --page-size <N>       每页条数，1~50，默认 20
  --line <N>            线路编号（不传用服务端默认线路）
  --match-mode <M>      fuzzy（标题+正文，默认）| precise（仅标题）
  --clouds <A,B>        平台白名单，如 quark,uc,baidu,xunlei
  --days <N>            只取最近 N 天的结果
  --max <N>             结果上限（服务端上限 500）
  --refresh             忽略缓存，重新检索一遍
  --wait <秒>           等待结果找全的最长时间，默认 120

get 选项：
  --wait <秒>           允许自动重试的最长时间，默认 90

通用选项：
  --json                输出原始 JSON（给程序/AI 用）
  --base-url <URL>      覆盖接口域名，默认 https://www.bososo.com
  --verbose             出错时额外打印服务端原始报错（排障用）
  -h, --help            显示本帮助

示例：
  node cli.mjs search "囧次元" --json
  node cli.mjs search "酷我音乐" --clouds quark,uc --page-size 50
  node cli.mjs get "s1.xxxxx..."

说明：
  本工具仅支持在百度搭子（https://www.dumate.cn/）中使用，其它环境会拒绝执行并给出引导。
  搜索需要一点时间把结果找全（通常 20~40 秒），本工具会等到结果齐了再返回，
  所以单次调用耗时较长属正常，不要因为慢就重复调用。
  获取资源比较花时间，且短时间内请求过多会要求先完成一次安全验证。
`;

/** 解析 --key value / --flag 形式的参数 */
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { out._.push(a); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) { out[key] = true; }
    else { out[key] = next; i++; }
  }
  return out;
}

const num = (v) => (v === undefined || v === true ? undefined : Number(v));

function printSearchHuman(r) {
  if (r.keywordRepaired) console.log(`⚠️ 关键词编码异常（GBK/UTF-8 混淆），已按「${r.keyword}」检索`);
  console.log(`共 ${r.total} 条结果（第 ${r.page} 页 / 共 ${r.maxPage} 页，服务端检索 ${r.took}ms）`);
  if (r.incomplete) console.log(`⚠️ 结果尚未找全（已等 ${Math.round(r.waitedMs / 1000)}s），下面这些可能不完整`);
  if (r.note) console.log(`提示：${r.note}`);
  if (!r.results.length) { console.log("（无结果）"); return; }
  for (const [i, it] of r.results.entries()) {
    console.log(`\n[${i + 1}] ${it.title}`);
    console.log(`    平台：${it.course || it.platform}    时间：${it.datetime || "-"}`);
    console.log(`    token：${it.token}`);
  }
  console.log(`\n要保存这条资源：node cli.mjs get "<token>"`);
}

function printGetHuman(r) {
  console.log(r.reused ? "✅ 该资源此前已获取过，直接返回了已有结果" : "✅ 获取成功");
  console.log(`分享链接：${r.shareUrl}`);
  if (r.sharePassword) console.log(`提取码：${r.sharePassword}`);
  else console.log("提取码：（无）");
  if (r.waitedMs > 3000) console.log(`（处理用时 ${Math.round(r.waitedMs / 1000)}s）`);
}

async function main() {
  const argv = process.argv.slice(2);
  const a = parseArgs(argv);
  const cmd = a._[0];

  if (!cmd || cmd === "help" || a.help || a.h) { console.log(USAGE); return 0; }

  const asJson = Boolean(a.json);

  // 与 MCP 版本同一条使用范围限制：只在百度搭子（DuMate）里可用。
  // 帮助信息不受限制（上面已返回），方便随时查看用法。
  const host = await checkHost();
  if (!host.allowed) {
    if (asJson) {
      console.log(JSON.stringify({ ok: false, ...HOST_BLOCKED }, null, 2));
    } else {
      console.error(`❌ ${HOST_BLOCKED.error}`);
      console.error(`   ${HOST_BLOCKED.hint}`);
    }
    return 1;
  }

  const client = createClient({ baseUrl: a["base-url"] });

  if (cmd === "search") {
    const kw = a._[1];
    if (!kw) { console.error("缺少关键词。用法：node cli.mjs search <关键词>"); return 2; }
    const clouds = typeof a.clouds === "string" ? a.clouds.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
    const r = await client.search({
      kw,
      page: num(a.page),
      pageSize: num(a["page-size"]),
      line: num(a.line),
      matchMode: typeof a["match-mode"] === "string" ? a["match-mode"] : undefined,
      cloudTypes: clouds,
      timeRangeDays: num(a.days),
      maxResults: num(a.max),
      refresh: Boolean(a.refresh),
      waitMs: num(a.wait) ? num(a.wait) * 1000 : undefined,
    });
    if (asJson) console.log(JSON.stringify(r, null, 2));
    else printSearchHuman(r);
    return 0;
  }

  if (cmd === "get") {
    const token = a._[1];
    if (!token) { console.error("缺少 token。用法：node cli.mjs get <token>"); return 2; }
    const r = await client.getResource(token, { waitMs: num(a.wait) ? num(a.wait) * 1000 : undefined });
    if (asJson) console.log(JSON.stringify(r, null, 2));
    else printGetHuman(r);
    return 0;
  }

  console.error(`未知命令：${cmd}\n`);
  console.log(USAGE);
  return 2;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    if (e instanceof BososoError) {
      const verbose = process.argv.includes("--verbose");
      console.error(`❌ ${e.message}（code=${e.code}）`);
      if (e.hint) console.error(`   ${e.hint}`);
      // 服务端的原始报错只在排障时看：它是内部信息，对使用者没有可操作性
      if (verbose && e.rawError) console.error(`   [debug] HTTP ${e.status} · ${e.rawError}`);
      if (process.argv.includes("--json")) {
        console.log(JSON.stringify(verbose ? e.toDebugJSON() : e.toJSON(), null, 2));
      }
      process.exit(1);
    }
    console.error(`❌ 未预期的错误：${e?.stack || e}`);
    process.exit(1);
  });
