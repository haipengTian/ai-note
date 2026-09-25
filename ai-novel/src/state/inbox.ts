/**
 * 收件箱（待办）处理与手动修正状态。纯函数。
 */
import crypto from "node:crypto";
import type { EventStatus, Novel, StateEvent } from "../model/types.js";
import type { z } from "zod";
import type { ManualEventSchema } from "../model/schemas.js";
import { markDownstreamStale } from "./stale.js";

export type InboxAction = "approve" | "reject" | "done" | "dismiss";

function closeItemsFor(n: Novel, eventId: string): Novel["inbox"] {
  return n.inbox.map((i) => (i.refId === eventId && i.status === "open" ? { ...i, status: "done" as const } : i));
}

/** 修改状态事件的生效状态，并关闭与之关联的待办 */
export function setEventStatus(n: Novel, eventId: string, status: EventStatus): Novel {
  if (!n.memory.events.some((e) => e.id === eventId)) throw new Error("状态事件不存在");
  return {
    ...n,
    memory: { ...n.memory, events: n.memory.events.map((e) => (e.id === eventId ? { ...e, status } : e)) },
    inbox: closeItemsFor(n, eventId),
  };
}

export function resolveInbox(n: Novel, itemId: string, action: InboxAction): Novel {
  const item = n.inbox.find((i) => i.id === itemId);
  if (!item) throw new Error("待办不存在");
  if (item.status !== "open") throw new Error("该待办已处理");

  if (item.kind === "state_proposal" && (action === "approve" || action === "reject") && item.refId) {
    const next = setEventStatus(n, item.refId, action === "approve" ? "applied" : "rejected");
    // 确认后状态从该章之后生效，已写的后续章节可能与之不符
    return action === "approve" && item.chapter ? markDownstreamStale(next, item.chapter, "的状态变化被确认") : next;
  }

  const status = action === "dismiss" ? ("dismissed" as const) : ("done" as const);
  const inbox = n.inbox.map((i) => (i.id === itemId ? { ...i, status } : i));
  if (item.kind === "stale_chapter" && item.chapter) {
    const prefix = `第 ${item.chapter} 章`;
    const chapters = n.chapters.map((c) => (c.stale?.startsWith(prefix) ? { ...c, stale: undefined } : c));
    return { ...n, inbox, chapters };
  }
  return { ...n, inbox };
}

export function addManualEvent(n: Novel, input: z.output<typeof ManualEventSchema>): Novel {
  if (!n.characters.some((c) => c.id === input.target)) throw new Error("人物不存在");
  const e: StateEvent = {
    id: crypto.randomBytes(6).toString("hex"),
    chapter: input.chapter,
    kind: input.kind,
    target: input.target,
    key: input.key,
    op: input.op,
    value: input.value,
    evidence: input.note || "（手动修正）",
    critical: false,
    status: "applied",
    source: "manual",
    createdAt: Date.now(),
  };
  return { ...n, memory: { ...n.memory, events: [...n.memory.events, e] } };
}
