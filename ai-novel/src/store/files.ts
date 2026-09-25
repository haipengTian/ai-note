/**
 * 存储底层：路径、原子写、按作品加锁。
 *   data/<id>/book.json | bible.json | structure.json | memory.json | inbox.json
 *   data/<id>/chapters/0001.txt   正文
 *   data/<id>/versions/0001/      章节历史版本
 *   data/<id>/snapshots/          记忆快照
 *   data/<id>/runs/0001/          每章生产留档（上下文、审校、抽取结果）
 */
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";

export const novelDir = (id: string) => {
  if (!/^[a-f0-9]{12}$/.test(id)) throw new Error("非法作品 ID");
  return path.join(config.dataDir, id);
};
export const pad = (index: number) => String(index).padStart(4, "0");
export const chapterFile = (id: string, index: number) => path.join(novelDir(id), "chapters", pad(index) + ".txt");
export const versionDir = (id: string, index: number) => path.join(novelDir(id), "versions", pad(index));
export const snapshotDir = (id: string) => path.join(novelDir(id), "snapshots");
export const runDir = (id: string, index: number) => path.join(novelDir(id), "runs", pad(index));

/** 文件名里只保留安全字符 */
export const safeName = (s: string) => s.replace(/[^\w一-龥-]+/g, "_").slice(0, 40);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function atomicWrite(file: string, data: string) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, data, "utf8");
  // Windows 上目标文件被杀毒软件/编辑器短暂占用时 rename 会 EPERM，稍后重试
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(tmp, file);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (attempt >= 4 || (code !== "EPERM" && code !== "EBUSY")) throw e;
      await sleep(50 * 2 ** attempt);
    }
  }
}

export async function readJSON<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`读取 ${path.basename(file)} 失败：${(e as Error).message}`);
  }
}

export async function exists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

// 同一作品的读-改-写串行化，避免并发覆盖
const locks = new Map<string, Promise<unknown>>();
export function withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(id) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(
    id,
    next.catch(() => undefined),
  );
  return next;
}

/** 删除目录中按名称排序最早的文件，只保留 keep 个 */
export async function pruneDir(dir: string, keep: number) {
  const files = (await fs.readdir(dir)).sort();
  for (const f of files.slice(0, Math.max(0, files.length - keep))) await fs.rm(path.join(dir, f), { force: true });
}
