/**
 * 章后记忆：抽取 → 校验 → 应用 / 生成提案；弧完成后生成冻结摘要，攒够后合并进全书梗概。
 */
import { chat, chatJSON } from "../llm.js";
import { DigestSchema } from "../model/schemas.js";
import type { Arc, Novel } from "../model/types.js";
import * as P from "../prompts/memory.js";
import { applyDigest, type DigestResult } from "../state/digest.js";
import { revertChapter } from "../state/events.js";
import { arcsAwaitingSummary, withSyncedArcs } from "../state/arcs.js";
import { store } from "../store/index.js";
import type { Job } from "../jobs.js";

/** 未并入梗概的已冻结弧达到这个数量时合并 */
const SYNOPSIS_MERGE_AT = 6;
/** 合并时保留最近几个弧摘要不并入，保证近期剧情细节 */
const SYNOPSIS_KEEP = 3;

export async function digestChapter(id: string, index: number, job: Job) {
  const n = await store.get(id);
  const chapter = n.chapters.find((c) => c.index === index);
  const text = await store.readChapter(id, index);
  if (!chapter || !text) return;
  job.log(`整理第 ${index} 章记忆（摘要、状态变化、伏笔）`);
  const d = await chatJSON(P.digestPrompt(revertChapter(n, index), chapter, text), DigestSchema, {
    role: "memory",
    onText: job.stream(`digest:${index}`, `第 ${index} 章记忆整理`),
    signal: job.signal,
  });
  if (job.signal.aborted) return;

  let result: DigestResult | undefined;
  await store.update(id, (x) => {
    // 先撤销本章旧的记忆再应用，重复整理不会叠加
    result = applyDigest(revertChapter(x, index), index, d, text);
    const novel = resolveNeedsDigest(result.novel, index);
    return withSyncedArcs({ ...novel, chapters: novel.chapters.map((c) => (c.index === index ? { ...c, stale: undefined } : c)) });
  });
  const r = result!;
  await store.writeRun(id, index, "digest", { at: Date.now(), digest: d, applied: r.applied, proposed: r.proposed, dropped: r.dropped, changes: r.changes });
  if (r.changes.length) job.log(`记忆更新：${r.changes.slice(0, 12).join("；")}${r.changes.length > 12 ? ` 等 ${r.changes.length} 项` : ""}`);
  if (r.dropped.length) job.log(`丢弃 ${r.dropped.length} 条不可信的抽取结果：${r.dropped.slice(0, 5).join("；")}`, "warn");
  if (r.proposed) job.log(`${r.proposed} 项关键变化待确认，请到「待办」处理`, "warn");
  job.updated();
  await summarizeArcs(id, job);
}

/** 重新整理过记忆后，关闭该章“需要重新整理”的待办 */
function resolveNeedsDigest(n: Novel, index: number): Novel {
  return {
    ...n,
    inbox: n.inbox.map((i) => (i.kind === "needs_digest" && i.chapter === index && i.status === "open" ? { ...i, status: "done" as const } : i)),
  };
}

/** 为已完成的弧生成冻结摘要；未并入梗概的弧摘要攒够后合并进全书梗概 */
export async function summarizeArcs(id: string, job: Job, force = false) {
  let n = withSyncedArcs(await store.get(id));
  for (const arc of arcsAwaitingSummary(n.arcs, n.memory.synopsisUpTo)) {
    if (job.signal.aborted) return;
    const chapters = n.chapters.filter((c) => c.index >= arc.range[0] && c.index <= arc.range[1]);
    if (chapters.some((c) => !c.summary)) {
      job.log(`第 ${arc.range[0]}~${arc.range[1]} 章有章节缺少摘要，暂不生成分段摘要`, "warn");
      continue;
    }
    job.log(`生成第 ${arc.range[0]}~${arc.range[1]} 章分段摘要`);
    const summary = (
      await chat(P.arcSummaryPrompt(n, arc, chapters), {
        role: "summary",
        onText: job.stream(`arc:${arc.index}`, `第 ${arc.range[0]}~${arc.range[1]} 章分段摘要`),
        signal: job.signal,
      })
    ).trim();
    if (job.signal.aborted) return;
    n = await store.update(id, (x) => withSyncedArcs({ ...x, arcs: x.arcs.map((a) => (a.id === arc.id ? { ...a, summary } : a)) }));
    job.updated();
  }

  const pending = n.arcs.filter((a) => a.summary && a.range[0] > n.memory.synopsisUpTo).sort((a, b) => a.index - b.index);
  const toMerge: Arc[] = force ? pending : pending.length >= SYNOPSIS_MERGE_AT ? pending.slice(0, -SYNOPSIS_KEEP) : [];
  if (!toMerge.length) return;
  const upTo = toMerge.at(-1)!.range[1];
  job.log(`更新全书梗概（并入第 ${toMerge[0].range[0]}~${upTo} 章）`);
  const synopsis = (
    await chat(P.synopsisPrompt(n, toMerge), {
      role: "summary",
      onText: job.stream("synopsis", "全书梗概"),
      signal: job.signal,
    })
  ).trim();
  if (job.signal.aborted) return;
  await store.update(id, (x) => ({ ...x, memory: { ...x.memory, bookSynopsis: synopsis, synopsisUpTo: upTo } }));
  job.updated();
}
