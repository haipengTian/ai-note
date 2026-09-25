/**
 * 后台任务：启动、停止、SSE 订阅。
 */
import { z } from "zod";
import type { Novel } from "../model/types.js";
import { firstUnwritten } from "../state/arcs.js";
import { store } from "../store/index.js";
import { jobs, type Job, type JobEvent } from "../jobs.js";
import * as pipe from "../pipeline/index.js";
import { HttpError, getNovel, parseBody, type Route } from "./http.js";

const JobSchema = z.object({
  kind: z.enum(["bootstrap", "worldview", "characters", "outline", "plan", "write", "rewrite", "auto", "review", "revise", "digest", "compress"]),
  extra: z.string().default(""),
  index: z.coerce.number().int().positive().optional(),
  from: z.coerce.number().int().positive().optional(),
  count: z.coerce.number().int().positive().optional(),
  instruction: z.string().optional(),
  autoRevise: z.boolean().default(false),
});

type JobInput = z.input<typeof JobSchema>;

function requireIndex(b: { index?: number }): number {
  if (!b.index) throw new HttpError(400, "缺少章节序号");
  return b.index;
}

/** 修订改变了正文，需要重新整理记忆 */
async function reviseThenDigest(id: string, index: number, j: Job) {
  await pipe.reviseChapter(id, index, j);
  if (!j.signal.aborted) await pipe.digestChapter(id, index, j);
}

async function reviewThenDigest(id: string, index: number, autoRevise: boolean, j: Job) {
  await pipe.reviewChapter(id, index, j, autoRevise);
  const c = (await store.get(id)).chapters.find((x) => x.index === index);
  if (!j.signal.aborted && c?.review?.revised) await pipe.digestChapter(id, index, j);
}

export function startJob(n: Novel, input: JobInput): Job {
  const b = JobSchema.parse(input);
  const extra = b.extra.trim();
  const nextIndex = firstUnwritten(n.chapters, n.targetChapters);
  switch (b.kind) {
    case "bootstrap":
      return jobs.start(n.id, b.kind, "一键生成：设定 → 人物 → 总纲 → 前 10 章大纲", (j) => pipe.bootstrap(n.id, j));
    case "worldview":
      return jobs.start(n.id, b.kind, "生成世界观设定", (j) => pipe.genWorldview(n.id, extra, j));
    case "characters":
      return jobs.start(n.id, b.kind, "生成人物", (j) => pipe.genCharacters(n.id, extra, j));
    case "outline":
      return jobs.start(n.id, b.kind, "生成全书总纲", (j) => pipe.genOutline(n.id, extra, j));
    case "plan": {
      const from = b.from ?? (n.chapters.at(-1)?.index ?? 0) + 1;
      const count = b.count ?? pipe.PLAN_BATCH;
      return jobs.start(n.id, b.kind, `规划第 ${from} 章起 ${count} 章大纲`, (j) => pipe.planChapters(n.id, from, count, j));
    }
    case "write": {
      const index = b.index ?? nextIndex;
      return jobs.start(n.id, b.kind, `撰写第 ${index} 章`, (j) => pipe.writeChapter(n.id, index, extra, j));
    }
    case "rewrite": {
      const index = requireIndex(b);
      if (!b.instruction?.trim()) throw new HttpError(400, "请填写修改要求");
      return jobs.start(n.id, b.kind, `修改第 ${index} 章`, (j) => pipe.rewriteChapter(n.id, index, b.instruction!.trim(), j));
    }
    case "auto": {
      const count = Math.min(b.count ?? 5, 200);
      return jobs.start(n.id, b.kind, `连续写作 ${count} 章（从第 ${nextIndex} 章开始）`, (j) => pipe.autoWrite(n.id, count, j));
    }
    case "review": {
      const index = requireIndex(b);
      return jobs.start(n.id, b.kind, `审校第 ${index} 章`, (j) => reviewThenDigest(n.id, index, b.autoRevise, j));
    }
    case "revise": {
      const index = requireIndex(b);
      return jobs.start(n.id, b.kind, `按审校意见修订第 ${index} 章`, (j) => reviseThenDigest(n.id, index, j));
    }
    case "digest": {
      const index = requireIndex(b);
      return jobs.start(n.id, b.kind, `重新整理第 ${index} 章记忆`, (j) => pipe.digestChapter(n.id, index, j));
    }
    case "compress":
      if (!n.chapters.some((c) => c.status === "written")) throw new HttpError(400, "还没有已写章节");
      return jobs.start(n.id, b.kind, "生成分段摘要并更新全书梗概", (j) => pipe.summarizeArcs(n.id, j, true));
  }
}

export const jobRoutes: Route[] = [
  [
    "POST",
    /^\/api\/novels\/(\w+)\/jobs$/,
    async ({ req, params }) => {
      const n = await getNovel(params[0]);
      const b = await parseBody(req, JobSchema);
      try {
        return startJob(n, b).snapshot();
      } catch (e) {
        if (e instanceof HttpError) throw e;
        throw new HttpError(409, (e as Error).message);
      }
    },
  ],

  [
    "POST",
    /^\/api\/jobs\/([\w-]+)\/stop$/,
    async ({ params }) => {
      jobs.get(params[0])?.stop();
      return { ok: true };
    },
  ],

  /** SSE：先发快照，再推实时事件 */
  [
    "GET",
    /^\/api\/jobs\/([\w-]+)\/stream$/,
    async ({ res, req, params }) => {
      const job = jobs.get(params[0]);
      if (!job) throw new HttpError(404, "任务不存在");
      res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", Connection: "keep-alive" });
      const write = (e: unknown) => !res.writableEnded && res.write(`data: ${JSON.stringify(e)}\n\n`);
      write({ type: "snapshot", job: job.snapshot() });
      if (job.status !== "running") return void res.end();
      const unsub = job.subscribe((e: JobEvent) => {
        write(e);
        if (e.type === "end") res.end();
      });
      const hb = setInterval(() => !res.writableEnded && res.write(": ping\n\n"), 15000);
      req.on("close", () => {
        clearInterval(hb);
        unsub();
      });
      return new Promise<void>((r) => res.on("close", () => r()));
    },
  ],
];
