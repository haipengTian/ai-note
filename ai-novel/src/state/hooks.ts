/**
 * 伏笔 / 悬念状态机。状态由 history 推导（recomputeHook），因此撤销某章只需删掉该章的记录。
 */
import crypto from "node:crypto";
import type { Hook, HookType, Source } from "../model/types.js";

/** minor 伏笔多少章没动静后不再主动注入 */
const RECENT_WINDOW = 30;
const MAX_MINOR = 12;

export function newHookId(existing: Set<string>): string {
  let id: string;
  do id = crypto.randomBytes(4).toString("hex");
  while (existing.has(id));
  return id;
}

/** 根据 history 重新计算 status / lastAdvancedIn / resolvedIn */
export function recomputeHook(h: Hook): Hook {
  const advances = h.history.filter((r) => r.op === "advance").map((r) => r.chapter);
  const resolve = h.history.find((r) => r.op === "resolve");
  const lastAdvancedIn = advances.length ? Math.max(...advances) : undefined;
  let status: Hook["status"];
  if (resolve) status = "resolved";
  else if (h.status === "deferred" || h.status === "abandoned") status = h.status;
  else status = advances.length ? "progressing" : "open";
  return { ...h, status, lastAdvancedIn, resolvedIn: resolve?.chapter };
}

export interface RelevantHook {
  hook: Hook;
  overdue: boolean;
}

const lastTouched = (h: Hook) => Math.max(h.plantedIn, h.lastAdvancedIn ?? 0);

/**
 * 写第 chapter 章时需要注入的伏笔：
 * - 所有未回收的 major
 * - 最近 RECENT_WINDOW 章内埋下/推进过的 minor（最多 maxMinor 条，取最近的）
 * - 回收窗口覆盖本章或已超期的 minor（总是注入）
 */
export function relevantHooks(
  hooks: Hook[],
  chapter: number,
  opt: { recentWindow?: number; maxMinor?: number } = {},
): RelevantHook[] {
  const recentWindow = opt.recentWindow ?? RECENT_WINDOW;
  const maxMinor = opt.maxMinor ?? MAX_MINOR;
  const active = hooks.filter((h) => (h.status === "open" || h.status === "progressing") && h.plantedIn < chapter);
  const overdue = (h: Hook) => Boolean(h.payoffWindow && h.payoffWindow[1] < chapter);
  const inWindow = (h: Hook) => Boolean(h.payoffWindow && h.payoffWindow[0] <= chapter && chapter <= h.payoffWindow[1]);

  const majors = active.filter((h) => h.importance === "major").sort((a, b) => a.plantedIn - b.plantedIn);
  const minors = active.filter((h) => h.importance === "minor");
  const forced = minors.filter((h) => overdue(h) || inWindow(h));
  const recent = minors
    .filter((h) => !forced.includes(h) && chapter - lastTouched(h) <= recentWindow)
    .sort((a, b) => lastTouched(b) - lastTouched(a))
    .slice(0, maxMinor);

  return [...majors, ...forced, ...recent].map((hook) => ({ hook, overdue: overdue(hook) }));
}

export type HookOpInput =
  | {
      op: "plant";
      content: string;
      type?: HookType;
      importance?: Hook["importance"];
      payoffWindow?: [number, number];
      note: string;
    }
  | { op: "advance" | "resolve"; id: string; note: string };

/** 应用一次伏笔操作，返回新数组 */
export function applyHookOp(hooks: Hook[], input: HookOpInput, chapter: number, source: Source): Hook[] {
  if (input.op === "plant") {
    const hook: Hook = {
      id: newHookId(new Set(hooks.map((h) => h.id))),
      type: input.type ?? "foreshadow",
      content: input.content,
      importance: input.importance ?? "minor",
      status: "open",
      plantedIn: chapter,
      payoffWindow: input.payoffWindow,
      history: [{ chapter, op: "plant", note: input.note, source }],
      source,
    };
    return [...hooks, hook];
  }
  if (!hooks.some((h) => h.id === input.id)) return hooks;
  return hooks.map((h) =>
    h.id === input.id ? recomputeHook({ ...h, history: [...h.history, { chapter, op: input.op, note: input.note, source }] }) : h,
  );
}
