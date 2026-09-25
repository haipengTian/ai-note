/**
 * HTTP 服务：静态前端 + JSON API + SSE 流式推送（零依赖，node:http）。
 */
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { SessionStore, type AgentEvent } from "./agent.js";
import { resolveInWorkspace, displayPath, IGNORED_DIRS } from "./util/path.js";

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");
const store = new SessionStore();

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function json(res: http.ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

async function readBody(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 5_000_000) throw new Error("请求体过大");
    chunks.push(c as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function serveStatic(res: http.ServerResponse, urlPath: string) {
  const rel = urlPath === "/" ? "index.html" : decodeURIComponent(urlPath.slice(1));
  const file = path.resolve(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR)) return json(res, 403, { error: "forbidden" });
  try {
    const data = await fs.readFile(file);
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(data);
  } catch {
    json(res, 404, { error: "not found" });
  }
}

type Handler = (req: http.IncomingMessage, res: http.ServerResponse, url: URL) => Promise<void>;

const routes: Record<string, Handler> = {
  "GET /api/info": async (_req, res) => {
    json(res, 200, {
      model: config.model,
      baseURL: config.baseURL,
      workspace: config.workspace,
      hasKey: Boolean(config.apiKey),
    });
  },

  "GET /api/sessions": async (_req, res) => {
    json(res, 200, store.list().map((s) => ({ id: s.id, title: s.title, createdAt: s.createdAt, busy: s.busy })));
  },

  "POST /api/sessions": async (_req, res) => {
    const s = store.create(config.workspace);
    json(res, 200, s.toJSON());
  },

  "GET /api/session": async (_req, res, url) => {
    const s = store.get(url.searchParams.get("id") || "");
    if (!s) return json(res, 404, { error: "会话不存在" });
    json(res, 200, s.toJSON());
  },

  "DELETE /api/session": async (_req, res, url) => {
    json(res, 200, { ok: store.delete(url.searchParams.get("id") || "") });
  },

  /** 发送消息，响应为 SSE 事件流 */
  "POST /api/chat": async (req, res) => {
    const { sessionId, message } = await readBody(req);
    const s = store.get(sessionId);
    if (!s) return json(res, 404, { error: "会话不存在" });
    if (s.busy) return json(res, 409, { error: "会话正在执行任务" });
    if (!message || typeof message !== "string") return json(res, 400, { error: "消息不能为空" });

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const emit = (e: AgentEvent) => {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify(e)}\n\n`);
    };
    const heartbeat = setInterval(() => !res.writableEnded && res.write(": ping\n\n"), 15_000);
    // 浏览器断开 => 中止任务
    res.on("close", () => {
      clearInterval(heartbeat);
      if (s.busy) s.stop();
    });
    await s.run(message, emit);
    clearInterval(heartbeat);
    res.end();
  },

  "POST /api/approve": async (req, res) => {
    const { sessionId, callId, approved } = await readBody(req);
    const s = store.get(sessionId);
    if (!s) return json(res, 404, { error: "会话不存在" });
    json(res, 200, { ok: s.approve(callId, Boolean(approved)) });
  },

  "POST /api/stop": async (req, res) => {
    const { sessionId } = await readBody(req);
    store.get(sessionId)?.stop();
    json(res, 200, { ok: true });
  },

  "POST /api/settings": async (req, res) => {
    const { sessionId, autoApprove } = await readBody(req);
    const s = store.get(sessionId);
    if (!s) return json(res, 404, { error: "会话不存在" });
    if (typeof autoApprove === "boolean") s.autoApprove = autoApprove;
    json(res, 200, { autoApprove: s.autoApprove });
  },

  /** 文件树（单层，前端按需展开） */
  "GET /api/tree": async (_req, res, url) => {
    const dir = resolveInWorkspace(config.workspace, url.searchParams.get("path") || ".");
    const entries = await fs.readdir(dir, { withFileTypes: true });
    json(
      res,
      200,
      entries
        .filter((e) => !(e.isDirectory() && IGNORED_DIRS.has(e.name)) && e.name !== ".DS_Store")
        .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
        .map((e) => ({ name: e.name, path: displayPath(config.workspace, path.join(dir, e.name)), dir: e.isDirectory() })),
    );
  },

  "GET /api/file": async (_req, res, url) => {
    const abs = resolveInWorkspace(config.workspace, url.searchParams.get("path") || "");
    const st = await fs.stat(abs);
    if (st.size > 2_000_000) return json(res, 413, { error: "文件过大" });
    const buf = await fs.readFile(abs);
    if (buf.subarray(0, 8000).includes(0)) return json(res, 415, { error: "二进制文件" });
    json(res, 200, { path: displayPath(config.workspace, abs), content: buf.toString("utf8") });
  },
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const handler = routes[`${req.method} ${url.pathname}`];
  try {
    if (handler) await handler(req, res, url);
    else if (req.method === "GET" && !url.pathname.startsWith("/api/")) await serveStatic(res, url.pathname);
    else json(res, 404, { error: "not found" });
  } catch (e) {
    if (!res.headersSent) json(res, 500, { error: (e as Error).message });
    else res.end();
  }
});

server.listen(config.port, config.host, () => {
  console.log(`\n  AI Coder 已启动`);
  console.log(`  ➜ 地址:   http://${config.host === "0.0.0.0" ? "localhost" : config.host}:${config.port}`);
  console.log(`  ➜ 工作区: ${config.workspace}`);
  console.log(`  ➜ 模型:   ${config.model} @ ${config.baseURL}`);
  if (!config.apiKey) console.log(`  ⚠ 未设置 OPENAI_API_KEY，请复制 .env.example 为 .env 并填写`);
  console.log();
});
