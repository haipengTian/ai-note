/**
 * HTTP 服务：静态前端 + JSON API + SSE 任务进度。路由定义在 routes/ 下。
 */
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { HttpError, type Route } from "./routes/http.js";
import { novelRoutes } from "./routes/novels.js";
import { chapterRoutes } from "./routes/chapters.js";
import { memoryRoutes } from "./routes/memory.js";
import { jobRoutes } from "./routes/jobs.js";

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

const routes: Route[] = [...novelRoutes, ...chapterRoutes, ...memoryRoutes, ...jobRoutes];

function send(res: http.ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

async function serveStatic(res: http.ServerResponse, p: string) {
  const file = path.resolve(PUBLIC_DIR, p === "/" ? "index.html" : decodeURIComponent(p.slice(1)));
  if (!file.startsWith(PUBLIC_DIR)) throw new HttpError(403, "forbidden");
  try {
    const data = await fs.readFile(file);
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(data);
  } catch {
    throw new HttpError(404, "not found");
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  try {
    for (const [method, pattern, handler] of routes) {
      const m = req.method === method && url.pathname.match(pattern);
      if (m) {
        const out = await handler({ req, res, params: m.slice(1), url });
        if (!res.headersSent) send(res, 200, out);
        return;
      }
    }
    if (req.method === "GET" && !url.pathname.startsWith("/api/")) return await serveStatic(res, url.pathname);
    throw new HttpError(404, "not found");
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status >= 500) console.error(`[${req.method} ${url.pathname}]`, e);
    if (!res.headersSent) send(res, status, { error: (e as Error).message });
    else res.end();
  }
});

server.listen(config.port, config.host, () => {
  console.log(`\n  📖 AI 小说工坊已启动`);
  console.log(`  ➜ 地址:  http://${config.host === "0.0.0.0" ? "localhost" : config.host}:${config.port}`);
  console.log(`  ➜ 模型:  写作 ${config.model} · 记忆 ${config.modelMemory} · 审校 ${config.modelReview} · 摘要 ${config.modelFast}`);
  console.log(`  ➜ 接口:  ${config.baseURL}`);
  console.log(`  ➜ 数据:  ${config.dataDir}`);
  if (!config.apiKey) console.log(`  ⚠ 未设置 OPENAI_API_KEY：复制 .env.example 为 .env 并填写`);
  console.log();
});
