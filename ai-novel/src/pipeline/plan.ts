/**
 * 章节大纲规划。
 */
import { config } from "../config.js";
import { chatJSON } from "../llm.js";
import { ChapterPlanSchema } from "../model/schemas.js";
import type { Chapter } from "../model/types.js";
import { chapterPlanPrompt } from "../prompts/plan.js";
import { withSyncedArcs } from "../state/arcs.js";
import { store } from "../store/index.js";
import type { Job } from "../jobs.js";

/** 每次自动规划章节大纲的数量 */
export const PLAN_BATCH = 10;
const MAX_BATCH = 30;

export async function planChapters(id: string, from: number, count: number, job: Job) {
  const n = await store.get(id);
  if (!n.outline) throw new Error("请先生成或填写全书总纲");
  const size = Math.min(count, Math.max(1, n.targetChapters - from + 1), MAX_BATCH);
  const to = from + size - 1;
  job.log(`规划第 ${from}~${to} 章大纲`);
  const res = await chatJSON(chapterPlanPrompt(n, from, size), ChapterPlanSchema, {
    model: config.model,
    temperature: 0.8,
    onText: job.stream(`plan:${from}`, `第 ${from}~${to} 章大纲`),
    signal: job.signal,
  });
  if (job.signal.aborted) return;
  const plans = res.chapters.filter((c) => c.title || c.outline).slice(0, size);
  await store.update(id, (x) => {
    const chapters = [...x.chapters];
    plans.forEach((p, i) => {
      const index = from + i; // 以顺序为准，防止模型编号出错
      const pos = chapters.findIndex((c) => c.index === index);
      if (pos >= 0 && chapters[pos].status === "written") return; // 已写的章节不覆盖
      const planned: Chapter = {
        index,
        title: (p.title || `第${index}章`).replace(/^第.+?章[\s:：]*/, ""),
        outline: p.outline,
        characters: p.characters,
        status: "planned",
        summary: "",
        words: 0,
      };
      if (pos >= 0) chapters[pos] = planned;
      else chapters.push(planned);
    });
    return withSyncedArcs({ ...x, chapters: chapters.sort((a, b) => a.index - b.index) });
  });
  job.log(`已规划 ${plans.length} 章`);
  job.updated();
}
