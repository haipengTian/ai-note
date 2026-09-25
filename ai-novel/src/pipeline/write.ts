/**
 * 正文：写作（含续写补字数）、按要求修改。写完后依次 审校 → 记忆回写。
 */
import { chat } from "../llm.js";
import * as P from "../prompts/write.js";
import { withSyncedArcs } from "../state/arcs.js";
import { markDownstreamStale } from "../state/stale.js";
import { store } from "../store/index.js";
import { cleanChapterText, countWords } from "../util/text.js";
import type { Job } from "../jobs.js";
import { chapterContext, saveContextRun } from "./context.js";
import { planChapters, PLAN_BATCH } from "./plan.js";
import { reviewChapter } from "./review.js";
import { digestChapter } from "./memory.js";

/** 字数低于目标的这个比例时自动续写一次 */
const MIN_RATIO = 0.6;

async function saveWritten(id: string, index: number, text: string, reason: string, wasWritten: boolean) {
  await store.writeChapter(id, index, text, reason);
  await store.update(id, (x) => {
    const chapters = x.chapters.map((c) =>
      c.index === index ? { ...c, status: "written" as const, words: countWords(text), updatedAt: Date.now(), review: undefined, stale: undefined } : c,
    );
    const next = withSyncedArcs({ ...x, chapters });
    return wasWritten ? markDownstreamStale(next, index, reason) : next;
  });
}

export async function writeChapter(id: string, index: number, extra: string, job: Job) {
  let n = await store.get(id);
  if (!n.chapters.some((c) => c.index === index)) {
    await planChapters(id, index, PLAN_BATCH, job);
    n = await store.get(id);
  }
  const chapter = n.chapters.find((c) => c.index === index);
  if (!chapter) throw new Error(`第 ${index} 章没有大纲`);
  const wasWritten = chapter.status === "written" && Boolean(await store.readChapter(id, index));

  // 写之前给人物和记忆拍快照，章节写坏了可以把记忆回滚到这里
  await store.snapshot(id, `写第${index}章前`);
  const compiled = await chapterContext(n, index);
  const messages = P.writeChapterPrompt(compiled.text, n, chapter, extra);
  await saveContextRun(n, index, "write", compiled, messages, job);

  job.log(`撰写第 ${index} 章《${chapter.title}》（上下文 ${compiled.chars} 字）`);
  const onText = job.stream(`chapter:${index}`, `第 ${index} 章 ${chapter.title}`);
  let text = await chat(messages, { onText, signal: job.signal });
  if (job.signal.aborted) return;

  if (countWords(text) < n.wordsPerChapter * MIN_RATIO) {
    job.log(`字数偏少（${countWords(text)}），自动续写`);
    onText("\n\n");
    const more = await chat(P.continueChapterPrompt(n, chapter, text), { onText, signal: job.signal });
    if (job.signal.aborted) return;
    text = text.trimEnd() + "\n\n" + more.trim();
  }
  text = cleanChapterText(text, chapter.title);

  await saveWritten(id, index, text, "整章重写", wasWritten);
  job.log(`第 ${index} 章完成，${countWords(text)} 字`);
  job.updated();

  if (n.settings.autoReview && !job.signal.aborted) await reviewChapter(id, index, job, true);
  if (!job.signal.aborted) await digestChapter(id, index, job);
}

export async function rewriteChapter(id: string, index: number, instruction: string, job: Job) {
  const n = await store.get(id);
  const chapter = n.chapters.find((c) => c.index === index);
  const old = await store.readChapter(id, index);
  if (!chapter || !old) throw new Error("该章节还没有正文");
  job.log(`按要求修改第 ${index} 章：${instruction}`);
  const compiled = await chapterContext(n, index);
  const messages = P.rewritePrompt(compiled.text, n, chapter, old, instruction);
  await saveContextRun(n, index, "rewrite", compiled, messages, job);
  const text = cleanChapterText(
    await chat(messages, { onText: job.stream(`chapter:${index}`, `修改第 ${index} 章`), signal: job.signal }),
    chapter.title,
  );
  if (job.signal.aborted) return;
  await saveWritten(id, index, text, "按要求修改", true);
  job.updated();
  // 记忆回写会先撤销本章旧的状态变化，再按新正文重新抽取
  await digestChapter(id, index, job);
}
