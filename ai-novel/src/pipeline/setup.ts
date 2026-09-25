/**
 * 设定层：世界观、人物、总纲，以及新建作品后的一键生成。
 */
import { config } from "../config.js";
import { chat, chatJSON } from "../llm.js";
import { CharactersSchema } from "../model/schemas.js";
import { emptyState, type Character } from "../model/types.js";
import * as P from "../prompts/setup.js";
import { store, newId } from "../store/index.js";
import type { Job } from "../jobs.js";
import { planChapters, PLAN_BATCH } from "./plan.js";

export async function genWorldview(id: string, extra: string, job: Job) {
  const n = await store.get(id);
  const text = await chat(P.worldviewPrompt(n, extra), { onText: job.stream("worldview", "世界观设定"), signal: job.signal });
  if (job.signal.aborted) return;
  await store.update(id, (x) => ({ ...x, worldview: text.trim() }));
  job.updated();
}

export async function genCharacters(id: string, extra: string, job: Job) {
  const n = await store.get(id);
  if (!n.worldview) job.log("还没有世界观设定，人物可能不够贴合，建议先生成设定", "warn");
  const res = await chatJSON(P.charactersPrompt(n, extra), CharactersSchema, {
    model: config.model,
    temperature: config.temperature,
    onText: job.stream("characters", "人物设计"),
    signal: job.signal,
  });
  if (job.signal.aborted) return;
  await store.update(id, (x) => {
    const byName = new Map(x.characters.map((c) => [c.name, c]));
    const generated: Character[] = res.characters.map((c) => {
      const old = byName.get(c.name.trim());
      return {
        id: old?.id ?? newId(),
        name: c.name.trim(),
        aliases: c.aliases,
        role: c.role || "配角",
        profile: c.profile,
        initial: { ...(old?.initial ?? emptyState()), attrs: c.attrs },
        firstAppearance: old?.firstAppearance,
        source: old?.source ?? "ai",
      };
    });
    // 没有出现在新结果里、但已被状态事件引用的人物必须保留，否则历史记忆会断
    const referenced = new Set(x.memory.events.map((e) => e.target));
    const names = new Set(generated.map((c) => c.name));
    const kept = x.characters.filter((c) => !names.has(c.name) && referenced.has(c.id));
    return { ...x, characters: [...generated, ...kept] };
  });
  job.log(`生成了 ${res.characters.length} 个人物`);
  job.updated();
}

export async function genOutline(id: string, extra: string, job: Job) {
  const n = await store.get(id);
  const text = await chat(P.outlinePrompt(n, extra), { onText: job.stream("outline", "全书总纲"), signal: job.signal });
  if (job.signal.aborted) return;
  await store.update(id, (x) => ({ ...x, outline: text.trim() }));
  job.updated();
}

/** 新建作品后一键生成：设定 → 人物 → 总纲 → 前 10 章大纲 */
export async function bootstrap(id: string, job: Job) {
  const steps: [string, () => Promise<void>][] = [
    ["世界观", () => genWorldview(id, "", job)],
    ["人物", () => genCharacters(id, "", job)],
    ["总纲", () => genOutline(id, "", job)],
    ["章节大纲", () => planChapters(id, 1, PLAN_BATCH, job)],
  ];
  for (let i = 0; i < steps.length; i++) {
    if (job.signal.aborted) return;
    job.setProgress(i, steps.length);
    await steps[i][1]();
  }
  job.setProgress(steps.length, steps.length);
}
