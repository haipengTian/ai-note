/**
 * 作品：列表、创建、读取、修改、删除、导出。
 */
import { z } from "zod";
import { config } from "../config.js";
import { usageTotal } from "../llm.js";
import { CharacterInputSchema, HookInputSchema } from "../model/schemas.js";
import { emptyState, type Character, type Novel } from "../model/types.js";
import { recomputeHook } from "../state/hooks.js";
import { withSyncedArcs } from "../state/arcs.js";
import { store, newId } from "../store/index.js";
import { jobs } from "../jobs.js";
import { ensureIdle, getNovel, novelView, parseBody, type Route } from "./http.js";
import { startJob } from "./jobs.js";

const CreateSchema = z.object({
  title: z.string().default(""),
  genre: z.string().default("玄幻"),
  idea: z.string().default(""),
  style: z.string().default(""),
  targetChapters: z.coerce.number().int().positive().default(100),
  wordsPerChapter: z.coerce.number().int().min(500).default(3000),
  bootstrap: z.boolean().default(false),
});

const PatchSchema = z.object({
  title: z.string().optional(),
  genre: z.string().optional(),
  idea: z.string().optional(),
  style: z.string().optional(),
  worldview: z.string().optional(),
  outline: z.string().optional(),
  targetChapters: z.coerce.number().int().positive().optional(),
  wordsPerChapter: z.coerce.number().int().min(500).optional(),
  characters: z.array(CharacterInputSchema).optional(),
  bookSynopsis: z.string().optional(),
  hooks: z.array(HookInputSchema).optional(),
  settings: z
    .object({
      autoReview: z.boolean().optional(),
      reviewThreshold: z.coerce.number().min(0).max(100).optional(),
      confirmCritical: z.boolean().optional(),
    })
    .optional(),
});

function mergeCharacters(old: Character[], input: z.output<typeof CharacterInputSchema>[]): Character[] {
  const byId = new Map(old.map((c) => [c.id, c]));
  return input.map((c) => {
    const prev = c.id ? byId.get(c.id) : undefined;
    return {
      id: prev?.id ?? newId(),
      name: c.name,
      aliases: c.aliases.filter(Boolean),
      role: c.role,
      profile: c.profile,
      initial: { ...(prev?.initial ?? emptyState()), attrs: c.initialAttrs },
      firstAppearance: prev?.firstAppearance,
      source: prev?.source ?? "manual",
    };
  });
}

function applyPatch(x: Novel, b: z.output<typeof PatchSchema>): Novel {
  const { characters, bookSynopsis, hooks, settings, ...fields } = b;
  const defined = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
  const next: Novel = {
    ...x,
    ...defined,
    characters: characters ? mergeCharacters(x.characters, characters) : x.characters,
    memory: {
      ...x.memory,
      bookSynopsis: bookSynopsis ?? x.memory.bookSynopsis,
      hooks: hooks ? hooks.map((h) => recomputeHook(h)) : x.memory.hooks,
    },
    settings: { ...x.settings, ...Object.fromEntries(Object.entries(settings ?? {}).filter(([, v]) => v !== undefined)) },
  };
  return b.targetChapters ? withSyncedArcs(next) : next;
}

export const novelRoutes: Route[] = [
  [
    "GET",
    /^\/api\/info$/,
    async () => ({
      model: config.model,
      modelFast: config.modelFast,
      modelReview: config.modelReview,
      modelMemory: config.modelMemory,
      baseURL: config.baseURL,
      hasKey: Boolean(config.apiKey),
      usage: usageTotal,
    }),
  ],

  [
    "GET",
    /^\/api\/novels$/,
    async () =>
      (await store.list()).map((n) => ({
        id: n.id,
        title: n.title,
        genre: n.genre,
        idea: n.idea,
        targetChapters: n.targetChapters,
        written: n.chapters.filter((c) => c.status === "written").length,
        totalWords: n.chapters.reduce((s, c) => s + (c.words || 0), 0),
        updatedAt: n.updatedAt,
        running: Boolean(jobs.running(n.id)),
        openInbox: n.inbox.filter((i) => i.status === "open").length,
      })),
  ],

  [
    "POST",
    /^\/api\/novels$/,
    async ({ req }) => {
      const b = await parseBody(req, CreateSchema);
      const n = await store.create(b);
      if (b.bootstrap) startJob(n, { kind: "bootstrap" });
      return novelView(n);
    },
  ],

  ["GET", /^\/api\/novels\/(\w+)$/, async ({ params }) => novelView(await getNovel(params[0]))],

  [
    "PATCH",
    /^\/api\/novels\/(\w+)$/,
    async ({ req, params }) => {
      await getNovel(params[0]);
      const b = await parseBody(req, PatchSchema);
      // 人物和伏笔是整组替换，任务运行中可能新增了条目，此时保存会把它们冲掉
      if (b.characters || b.hooks) ensureIdle(params[0]);
      return novelView(await store.update(params[0], (x) => applyPatch(x, b)));
    },
  ],

  [
    "DELETE",
    /^\/api\/novels\/(\w+)$/,
    async ({ params }) => {
      await getNovel(params[0]);
      jobs.running(params[0])?.stop();
      await store.remove(params[0]);
      return { ok: true };
    },
  ],

  [
    "GET",
    /^\/api\/novels\/(\w+)\/export$/,
    async ({ res, params, url }) => {
      const n = await getNovel(params[0]);
      const md = url.searchParams.get("format") === "md";
      const parts: string[] = [md ? `# ${n.title}\n` : `${n.title}\n\n`];
      for (const c of n.chapters.filter((c) => c.status === "written")) {
        const text = await store.readChapter(n.id, c.index);
        parts.push(md ? `\n## 第${c.index}章 ${c.title}\n\n${text}\n` : `\n第${c.index}章 ${c.title}\n\n${text}\n`);
      }
      const filename = encodeURIComponent(`${n.title}.${md ? "md" : "txt"}`);
      res.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
      });
      res.end(parts.join(""));
    },
  ],
];
