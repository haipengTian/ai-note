/**
 * 模型输出与接口输入的校验（Zod）。
 * 模型输出要“宽进严出”：单个条目非法时丢弃该条目，而不是让整次生成失败。
 */
import { z } from "zod";

/** 数组中逐条校验，非法条目直接丢弃 */
function lenientArray<T extends z.ZodTypeAny>(item: T) {
  return z
    .array(z.unknown())
    .catch([])
    .default([])
    .transform((arr) =>
      arr.flatMap((x) => {
        const r = item.safeParse(x);
        return r.success ? [r.data as z.output<T>] : [];
      }),
    );
}

const str = z.coerce.string().catch("");
const optStr = z.coerce.string().optional().catch(undefined);
const stringRecord = z
  .record(z.unknown())
  .catch({})
  .default({})
  .transform((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v)])));

// ------------------------------------------------------------------ 章后记忆抽取
const DigestEvent = z.object({
  character: z.string().min(1),
  kind: z.enum(["attr", "relation", "knowledge", "inventory", "life"]),
  key: str.default(""),
  op: z.enum(["set", "add", "remove"]).catch("set").default("set"),
  value: z
    .union([z.number(), z.string()])
    .optional()
    .transform((v) => (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : v)),
  evidence: str.default(""),
});

const DigestNewCharacter = z.object({
  name: z.string().min(1),
  aliases: z.array(z.coerce.string()).catch([]).default([]),
  role: str.default("配角"),
  profile: str.default(""),
  attrs: stringRecord,
});

const DigestSecret = z.object({
  ref: z.coerce.string().min(1),
  content: z.string().min(1),
  knownToReader: z.boolean().catch(true).default(true),
});

const DigestHook = z.object({
  op: z.enum(["plant", "advance", "resolve"]),
  id: optStr,
  content: optStr,
  type: z.enum(["foreshadow", "mystery", "promise", "conflict"]).optional().catch(undefined),
  importance: z.enum(["major", "minor"]).optional().catch(undefined),
  note: str.default(""),
});

export const DigestSchema = z.object({
  summary: str.default(""),
  events: lenientArray(DigestEvent),
  newCharacters: lenientArray(DigestNewCharacter),
  newSecrets: lenientArray(DigestSecret),
  hooks: lenientArray(DigestHook),
});

export type Digest = z.output<typeof DigestSchema>;
export type DigestEventInput = Digest["events"][number];

export function parseDigest(raw: unknown): Digest {
  return DigestSchema.parse(raw ?? {});
}

// ------------------------------------------------------------------ 人物设计
export const CharactersSchema = z.object({
  characters: lenientArray(
    z.object({
      name: z.string().min(1),
      aliases: z.array(z.coerce.string()).catch([]).default([]),
      role: str.default("配角"),
      profile: str.default(""),
      attrs: stringRecord,
    }),
  ),
});

// ------------------------------------------------------------------ 章节大纲
export const ChapterPlanSchema = z.object({
  chapters: lenientArray(
    z.object({
      title: str.default(""),
      outline: str.default(""),
      characters: z.array(z.coerce.string()).catch([]).default([]),
    }),
  ),
});

// ------------------------------------------------------------------ 审校
export const ReviewSchema = z.object({
  score: z.coerce.number().catch(0).default(0),
  verdict: z.enum(["pass", "revise"]).catch("revise").default("revise"),
  issues: lenientArray(
    z.object({
      dimension: str.default("其他"),
      severity: z.enum(["high", "medium", "low"]).catch("medium").default("medium"),
      quote: str.default(""),
      problem: z.string().min(1),
      suggestion: str.default(""),
    }),
  ),
  strengths: z.array(z.coerce.string()).catch([]).default([]),
});

// ------------------------------------------------------------------ 接口输入
export const CharacterInputSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1),
  aliases: z.array(z.string().trim()).default([]),
  role: z.string().default(""),
  profile: z.string().default(""),
  initialAttrs: z.record(z.string()).default({}),
});

export const HookInputSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["foreshadow", "mystery", "promise", "conflict"]),
  content: z.string().min(1),
  importance: z.enum(["major", "minor"]),
  status: z.enum(["open", "progressing", "deferred", "resolved", "abandoned"]),
  plantedIn: z.number().int().min(0),
  payoffWindow: z.tuple([z.number().int(), z.number().int()]).optional(),
  history: z.array(
    z.object({
      chapter: z.number().int(),
      op: z.enum(["plant", "advance", "resolve"]),
      note: z.string(),
      source: z.enum(["ai", "manual", "migrated"]).optional(),
    }),
  ),
  source: z.enum(["ai", "manual", "migrated"]).default("manual"),
});

export const ManualEventSchema = z.object({
  chapter: z.number().int().min(0),
  kind: z.enum(["attr", "relation", "knowledge", "inventory", "life"]),
  target: z.string().min(1),
  key: z.string().optional(),
  op: z.enum(["set", "add", "remove"]),
  value: z.union([z.string(), z.number()]).optional(),
  note: z.string().default(""),
});
