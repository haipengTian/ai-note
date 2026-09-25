/**
 * 记忆：任意章节时的人物状态、手动修正、待办处理、快照。
 */
import { z } from "zod";
import { ManualEventSchema } from "../model/schemas.js";
import { stateAt } from "../state/events.js";
import { addManualEvent, resolveInbox, setEventStatus } from "../state/inbox.js";
import { store } from "../store/index.js";
import { HttpError, ensureIdle, getNovel, novelView, parseBody, type Route } from "./http.js";

/** 纯函数抛出的业务错误转成 400 */
function asBadRequest<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
}

export const memoryRoutes: Route[] = [
  /** 第 at 章开写前的人物状态（不传 at 则为最新） */
  [
    "GET",
    /^\/api\/novels\/(\w+)\/state$/,
    async ({ params, url }) => {
      const n = await getNovel(params[0]);
      const latest = (n.chapters.filter((c) => c.status === "written").at(-1)?.index ?? 0) + 1;
      const at = Number(url.searchParams.get("at")) || latest;
      return { at, states: stateAt(n.characters, n.memory.events, at) };
    },
  ],

  [
    "POST",
    /^\/api\/novels\/(\w+)\/events$/,
    async ({ req, params }) => {
      await getNovel(params[0]);
      ensureIdle(params[0]);
      const b = await parseBody(req, ManualEventSchema);
      const n = await store.update(params[0], (x) => asBadRequest(() => addManualEvent(x, b)));
      return novelView(n);
    },
  ],

  [
    "PATCH",
    /^\/api\/novels\/(\w+)\/events\/(\w+)$/,
    async ({ req, params }) => {
      await getNovel(params[0]);
      ensureIdle(params[0]);
      const { status } = await parseBody(req, z.object({ status: z.enum(["applied", "rejected"]) }));
      const n = await store.update(params[0], (x) => asBadRequest(() => setEventStatus(x, params[1], status)));
      return novelView(n);
    },
  ],

  [
    "DELETE",
    /^\/api\/novels\/(\w+)\/events\/(\w+)$/,
    async ({ params }) => {
      await getNovel(params[0]);
      ensureIdle(params[0]);
      const n = await store.update(params[0], (x) => ({
        ...x,
        memory: { ...x.memory, events: x.memory.events.filter((e) => e.id !== params[1]) },
        inbox: x.inbox.map((i) => (i.refId === params[1] && i.status === "open" ? { ...i, status: "dismissed" as const } : i)),
      }));
      return novelView(n);
    },
  ],

  [
    "POST",
    /^\/api\/novels\/(\w+)\/inbox\/(\w+)$/,
    async ({ req, params }) => {
      await getNovel(params[0]);
      const { action } = await parseBody(req, z.object({ action: z.enum(["approve", "reject", "done", "dismiss"]) }));
      const n = await store.update(params[0], (x) => asBadRequest(() => resolveInbox(x, params[1], action)));
      return novelView(n);
    },
  ],

  // ---------------- 记忆快照 ----------------
  [
    "GET",
    /^\/api\/novels\/(\w+)\/snapshots$/,
    async ({ params }) => {
      await getNovel(params[0]);
      return store.listSnapshots(params[0]);
    },
  ],

  [
    "POST",
    /^\/api\/novels\/(\w+)\/snapshots\/([^/]+)\/restore$/,
    async ({ params }) => {
      await getNovel(params[0]);
      ensureIdle(params[0]);
      return novelView(await store.restoreSnapshot(params[0], decodeURIComponent(params[1])));
    },
  ],
];
