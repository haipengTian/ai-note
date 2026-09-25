// 端到端冒烟测试：配合 scripts/mock-llm.ts 使用，走一遍 创建 → 生成设定 → 连续写作 → 确认提案 → 继续写。
//   node scripts/smoke.mjs [http://127.0.0.1:3100]
const BASE = process.argv[2] || "http://127.0.0.1:3100";

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${data.error}`);
  return data;
}

async function waitJob(id) {
  for (let i = 0; i < 300; i++) {
    const n = await api("GET", `/api/novels/${id}`);
    if (n.job && n.job.status !== "running") return n;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("任务超时");
}

function check(cond, msg) {
  if (!cond) throw new Error("✗ " + msg);
  console.log("✓ " + msg);
}

const created = await api("POST", "/api/novels", { title: "冒烟测试", idea: "废柴逆袭", targetChapters: 30, wordsPerChapter: 1000, bootstrap: true });
let n = await waitJob(created.id);
check(n.job.status === "done", `一键生成完成（${n.job.status}）`);
check(n.characters.length === 3 && n.chapters.length === 10, `3 个人物、10 章大纲`);
check(n.characters[0].initial.attrs["境界/实力"] === "炼气三层", "人物初始状态为结构化键值");

await api("POST", `/api/novels/${n.id}/jobs`, { kind: "auto", count: 3 });
n = await waitJob(n.id);
check(n.job.status === "paused", `连续写作遇到关键变化后暂停（${n.job.status}：${n.job.error ?? ""}）`);
check(n.chapters.filter((c) => c.status === "written").length === 1, "只写了 1 章就暂停");
const proposals = n.inbox.filter((i) => i.status === "open" && i.kind === "state_proposal");
check(proposals.length === 1, `生成 1 条关键变化提案：${proposals[0]?.title}`);
const lin = n.characters.find((c) => c.name === "林凡");
check(n.currentStates[lin.id].attrs["境界/实力"] === "炼气三层", "提案确认前境界不变");
check(n.currentStates[lin.id].inventory["灵石"] === 10, "普通变化（灵石 +10）直接生效");
check(n.currentStates[lin.id].attrs["伤势"] === undefined, "证据不符的编造事件被丢弃");
check(n.memory.hooks.some((h) => h.importance === "major"), "埋下主线伏笔");

const digest = await api("GET", `/api/novels/${n.id}/chapters/1/runs/digest`);
check(digest.dropped.some((d) => d.includes("证据")), `留档记录了丢弃原因：${digest.dropped[0]}`);
const ctx = await api("GET", `/api/novels/${n.id}/chapters/1/runs/context-write`);
check(ctx.trace.some((t) => t.id === "states"), `写作上下文留档（${ctx.chars} 字，${ctx.trace.length} 块）`);

n = await api("POST", `/api/novels/${n.id}/inbox/${proposals[0].id}`, { action: "approve" });
check(n.currentStates[lin.id].attrs["境界/实力"] === "炼气4层", "确认后境界更新为炼气4层");

// 关掉人工确认，连续写到第 11 章，触发第一个弧的分段摘要
n = await api("PATCH", `/api/novels/${n.id}`, { settings: { confirmCritical: false } });
await api("POST", `/api/novels/${n.id}/jobs`, { kind: "auto", count: 10 });
n = await waitJob(n.id);
check(n.job.status === "done", `连续写作 10 章完成（${n.job.status} ${n.job.error ?? ""}）`);
check(n.chapters.filter((c) => c.status === "written").length === 11, "共写 11 章（大纲不够时自动规划）");
check(n.currentStates[lin.id].inventory["灵石"] === 660, `灵石按章累加：${n.currentStates[lin.id].inventory["灵石"]}`);
check(Boolean(n.arcs[0].summary) && n.arcs[0].status === "done", "第 1~10 章分段摘要已冻结");

const at5 = await api("GET", `/api/novels/${n.id}/state?at=5`);
check(at5.states[lin.id].attrs["境界/实力"] === "炼气7层", "可以回看第 5 章开写前的状态");

// 重写第 3 章：旧事件被撤销后重新抽取，后续章节被标记为待复查
await api("POST", `/api/novels/${n.id}/jobs`, { kind: "write", index: 3 });
n = await waitJob(n.id);
check(n.job.status === "done", "重写第 3 章完成");
check(n.chapters.find((c) => c.index === 4).stale, "第 4 章被标记为待复查");
check(n.currentStates[lin.id].inventory["灵石"] === 660, "重写后灵石没有重复累加");

console.log("\n全部通过");
