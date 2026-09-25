/**
 * 下游影响：某章正文变化后，后续已写章节可能与之不一致。
 */
import crypto from "node:crypto";
import type { InboxItem, Novel } from "../model/types.js";

/** 把第 index 章之后的已写章节标记为可能不一致，并放一条非阻塞待办（同一章的旧提醒被替换） */
export function markDownstreamStale(n: Novel, index: number, reason: string): Novel {
  const affected = n.chapters.filter((c) => c.index > index && c.status === "written");
  if (!affected.length) return n;
  const note = `第 ${index} 章${reason}后未复查`;
  const item: InboxItem = {
    id: crypto.randomBytes(6).toString("hex"),
    kind: "stale_chapter",
    chapter: index,
    title: `第 ${index} 章${reason}，后续 ${affected.length} 章可能与之不一致`,
    detail: `涉及第 ${affected[0].index}~${affected.at(-1)!.index} 章。可以逐章审校检查，或确认无影响后忽略。`,
    blocking: false,
    status: "open",
    createdAt: Date.now(),
  };
  const ids = new Set(affected.map((c) => c.index));
  return {
    ...n,
    chapters: n.chapters.map((c) => (ids.has(c.index) ? { ...c, stale: note } : c)),
    inbox: [...n.inbox.filter((i) => !(i.kind === "stale_chapter" && i.chapter === index && i.status === "open")), item],
  };
}

/** 正文被手动修改/恢复后，记忆可能与正文不符：放一条“重新整理记忆”待办（同一章只保留一条） */
export function requestDigest(n: Novel, index: number, reason: string): Novel {
  const item: InboxItem = {
    id: crypto.randomBytes(6).toString("hex"),
    kind: "needs_digest",
    chapter: index,
    title: `第 ${index} 章正文已${reason}，记忆可能与正文不符`,
    detail: "建议重新整理本章记忆（会先撤销本章旧的状态变化，再按新正文抽取）。",
    blocking: false,
    status: "open",
    createdAt: Date.now(),
  };
  return {
    ...n,
    inbox: [...n.inbox.filter((i) => !(i.kind === "needs_digest" && i.chapter === index && i.status === "open")), item],
  };
}
