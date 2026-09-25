/**
 * 一键连续写作。遇到阻塞性待办（如待确认的关键状态变化）时暂停。
 */
import { PauseSignal, type Job } from "../jobs.js";
import type { Novel } from "../model/types.js";
import { firstUnwritten } from "../state/arcs.js";
import { store } from "../store/index.js";
import { planChapters, PLAN_BATCH } from "./plan.js";
import { writeChapter } from "./write.js";

export function blockingItems(n: Novel) {
  return n.inbox.filter((i) => i.status === "open" && i.blocking);
}

export async function autoWrite(id: string, count: number, job: Job) {
  for (let k = 0; k < count; k++) {
    if (job.signal.aborted) return;
    const n = await store.get(id);
    const blocking = blockingItems(n);
    if (blocking.length) throw new PauseSignal(`有 ${blocking.length} 项待确认，处理后再继续（${blocking[0].title}）`);
    const next = firstUnwritten(n.chapters, n.targetChapters);
    if (next > n.targetChapters) {
      job.log(`已达到规划的 ${n.targetChapters} 章`, "warn");
      return;
    }
    job.setProgress(k, count);
    if (!n.chapters.some((c) => c.index === next)) await planChapters(id, next, PLAN_BATCH, job);
    await writeChapter(id, next, "", job);
  }
  job.setProgress(count, count);
  const left = blockingItems(await store.get(id));
  if (left.length) job.log(`有 ${left.length} 项待确认，请到「待办」处理`, "warn");
}
