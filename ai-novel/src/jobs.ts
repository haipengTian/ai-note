/**
 * 后台任务：生成操作都以任务形式在服务端运行，关掉浏览器也不会中断。
 * 前端通过 SSE 订阅任务进度（日志 + 实时生成的文字）。
 */
import crypto from "node:crypto";

export type JobStatus = "running" | "done" | "error" | "stopped" | "paused";

/** 闸门触发时抛出：任务以 paused 结束，等待人工处理收件箱 */
export class PauseSignal extends Error {}

export type JobEvent =
  | { type: "log"; msg: string; level: "info" | "warn" | "error"; t: number }
  | { type: "stream"; target: string; label: string }
  | { type: "delta"; text: string }
  | { type: "progress"; done: number; total: number }
  | { type: "updated" }
  | { type: "end"; status: JobStatus; error?: string };

export class Job {
  readonly id = crypto.randomUUID();
  readonly startedAt = Date.now();
  status: JobStatus = "running";
  error?: string;
  logs: Extract<JobEvent, { type: "log" }>[] = [];
  current: { target: string; label: string; text: string } | null = null;
  progress = { done: 0, total: 0 };
  private controller = new AbortController();
  private subs = new Set<(e: JobEvent) => void>();

  constructor(
    readonly novelId: string,
    readonly kind: string,
    readonly label: string,
  ) {}

  get signal() {
    return this.controller.signal;
  }

  private emit(e: JobEvent) {
    for (const s of this.subs) s(e);
  }

  log(msg: string, level: "info" | "warn" | "error" = "info") {
    const e = { type: "log" as const, msg, level, t: Date.now() };
    this.logs.push(e);
    if (this.logs.length > 500) this.logs.shift();
    this.emit(e);
  }

  /** 开始一段流式输出，返回给 LLM 的 onText 回调 */
  stream(target: string, label: string) {
    this.current = { target, label, text: "" };
    this.emit({ type: "stream", target, label });
    return (delta: string) => {
      if (this.current) this.current.text += delta;
      this.emit({ type: "delta", text: delta });
    };
  }

  setProgress(done: number, total: number) {
    this.progress = { done, total };
    this.emit({ type: "progress", done, total });
  }

  /** 通知前端作品数据有变化，需要刷新 */
  updated() {
    this.emit({ type: "updated" });
  }

  stop() {
    this.controller.abort();
  }

  finish(status: JobStatus, error?: string) {
    this.status = status;
    this.error = error;
    this.emit({ type: "end", status, error });
    this.subs.clear();
  }

  subscribe(fn: (e: JobEvent) => void) {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }

  snapshot() {
    return {
      id: this.id,
      novelId: this.novelId,
      kind: this.kind,
      label: this.label,
      status: this.status,
      error: this.error,
      startedAt: this.startedAt,
      logs: this.logs,
      current: this.current,
      progress: this.progress,
    };
  }
}

class JobManager {
  private jobs = new Map<string, Job>();
  private latestByNovel = new Map<string, Job>();

  running(novelId: string): Job | undefined {
    const j = this.latestByNovel.get(novelId);
    return j?.status === "running" ? j : undefined;
  }

  latest(novelId: string) {
    return this.latestByNovel.get(novelId);
  }

  get(id: string) {
    return this.jobs.get(id);
  }

  start(novelId: string, kind: string, label: string, fn: (job: Job) => Promise<void>): Job {
    if (this.running(novelId)) throw new Error("该作品已有任务在运行，请等待完成或先停止");
    const job = new Job(novelId, kind, label);
    this.jobs.set(job.id, job);
    this.latestByNovel.set(novelId, job);
    job.log(`开始：${label}`);
    fn(job)
      .then(() => {
        job.log(job.signal.aborted ? "已停止" : "完成");
        job.finish(job.signal.aborted ? "stopped" : "done");
      })
      .catch((e: Error) => {
        if (e instanceof PauseSignal) {
          job.log(`已暂停：${e.message}`, "warn");
          job.finish("paused", e.message);
        } else if (job.signal.aborted) {
          job.log("已停止", "warn");
          job.finish("stopped");
        } else {
          job.log(`出错：${e.message}`, "error");
          job.finish("error", e.message);
        }
      });
    // 清理很久以前的任务
    for (const [id, j] of this.jobs) if (j.status !== "running" && Date.now() - j.startedAt > 6 * 3600_000) this.jobs.delete(id);
    return job;
  }
}

export const jobs = new JobManager();
