/**
 * 章节上下文：取材 → 编排 → 留档（runs/<章>/context-<任务>.json）。
 */
import { config } from "../config.js";
import type { Msg } from "../llm.js";
import type { Novel } from "../model/types.js";
import { compile, type Compiled } from "../context/compiler.js";
import { chapterBlocks } from "../context/select.js";
import { revertChapter } from "../state/events.js";
import { store } from "../store/index.js";
import type { Job } from "../jobs.js";

/**
 * 编排第 index 章的写作/审校上下文。
 * 基于“撤销本章记忆后”的作品计算：重写或复审时，旧版本本章产生的状态、伏笔变化不应影响判断。
 */
export async function chapterContext(n: Novel, index: number): Promise<Compiled> {
  const prevText = index > 1 ? await store.readChapter(n.id, index - 1) : "";
  return compile(chapterBlocks(revertChapter(n, index), index, prevText), config.contextBudget);
}

export async function saveContextRun(n: Novel, index: number, task: string, compiled: Compiled, messages: Msg[], job: Job) {
  if (compiled.overBudget) job.log(`上下文 ${compiled.chars} 字超出预算 ${compiled.budget}（只剩必须保留的内容）`, "warn");
  const trimmed = compiled.trace.filter((t) => t.status !== "full");
  if (trimmed.length) job.log(`上下文超预算，已裁剪：${trimmed.map((t) => `${t.title.replace(/^#\s*/, "")}(${t.status === "dropped" ? "丢弃" : "缩略"})`).join("、")}`);
  await store.writeRun(n.id, index, `context-${task}`, {
    at: Date.now(),
    task,
    chars: compiled.chars,
    budget: compiled.budget,
    overBudget: compiled.overBudget,
    trace: compiled.trace,
    messages,
  });
}
