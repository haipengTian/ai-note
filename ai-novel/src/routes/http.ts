/**
 * 路由公共工具：错误类型、请求体解析、作品视图。
 */
import type http from "node:http";
import type { z, ZodTypeAny } from "zod";
import type { Novel } from "../model/types.js";
import { stateAt } from "../state/events.js";
import { store } from "../store/index.js";
import { jobs } from "../jobs.js";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    msg: string,
  ) {
    super(msg);
  }
}

export type Ctx = { req: http.IncomingMessage; res: http.ServerResponse; params: string[]; url: URL };
export type Route = [method: string, pattern: RegExp, handler: (c: Ctx) => Promise<unknown>];

const MAX_BODY = 5_000_000;

export async function body(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, "请求体过大");
    chunks.push(c as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, "请求体不是合法 JSON");
  }
}

/** 按 schema 校验请求体，失败返回 400 和可读的错误 */
export async function parseBody<S extends ZodTypeAny>(req: http.IncomingMessage, schema: S): Promise<z.output<S>> {
  const r = schema.safeParse(await body(req));
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join(".") || "请求"}：${i.message}`).join("；");
    throw new HttpError(400, `参数错误：${msg}`);
  }
  return r.data;
}

export async function getNovel(id: string): Promise<Novel> {
  try {
    return await store.get(id);
  } catch (e) {
    if ((e as Error).message === "非法作品 ID") throw new HttpError(400, "非法作品 ID");
    throw new HttpError(404, "作品不存在");
  }
}

export function ensureIdle(id: string) {
  if (jobs.running(id)) throw new HttpError(409, "有任务正在运行，请稍后再操作");
}

const lastWritten = (n: Novel) => n.chapters.filter((c) => c.status === "written").at(-1)?.index ?? 0;

/** 返回给前端的作品视图：附带当前任务、总字数、最新人物状态、待办数 */
export function novelView(n: Novel) {
  const job = jobs.latest(n.id);
  const upTo = lastWritten(n);
  return {
    ...n,
    job: job?.snapshot() ?? null,
    totalWords: n.chapters.reduce((s, c) => s + (c.words || 0), 0),
    stateAt: upTo + 1,
    currentStates: stateAt(n.characters, n.memory.events, upTo + 1),
    openInbox: n.inbox.filter((i) => i.status === "open").length,
  };
}
