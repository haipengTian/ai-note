/**
 * 作品存储（v2 分文件）。读取到 v0.2 的 novel.json 时自动迁移，原文件改名为 novel.v1.backup.json。
 */
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "../config.js";
import {
  DEFAULT_SETTINGS,
  SCHEMA_VERSION,
  emptyMemory,
  type Arc,
  type Chapter,
  type Character,
  type InboxItem,
  type Memory,
  type Novel,
} from "../model/types.js";
import { isV1, migrateV1 } from "../model/migrate.js";
import { atomicWrite, chapterFile, exists, novelDir, readJSON, runDir, withLock } from "./files.js";
import * as history from "./history.js";

export type { VersionInfo, SnapshotInfo } from "./history.js";

export const newId = () => crypto.randomBytes(6).toString("hex");

type BookFile = Pick<
  Novel,
  "schemaVersion" | "id" | "title" | "genre" | "idea" | "style" | "targetChapters" | "wordsPerChapter" | "settings" | "createdAt" | "updatedAt"
>;
interface BibleFile {
  worldview: string;
  characters: Character[];
}
interface StructureFile {
  outline: string;
  arcs: Arc[];
  chapters: Chapter[];
}
interface InboxFile {
  items: InboxItem[];
}

const part = (id: string, name: string) => path.join(novelDir(id), name);

async function writeParts(n: Novel) {
  const book: BookFile = {
    schemaVersion: n.schemaVersion,
    id: n.id,
    title: n.title,
    genre: n.genre,
    idea: n.idea,
    style: n.style,
    targetChapters: n.targetChapters,
    wordsPerChapter: n.wordsPerChapter,
    settings: n.settings,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
  };
  const files: [string, unknown][] = [
    ["bible.json", { worldview: n.worldview, characters: n.characters } satisfies BibleFile],
    ["structure.json", { outline: n.outline, arcs: n.arcs, chapters: n.chapters } satisfies StructureFile],
    ["memory.json", n.memory satisfies Memory],
    ["inbox.json", { items: n.inbox } satisfies InboxFile],
    // book.json 最后写：它是“作品存在”的标志
    ["book.json", book],
  ];
  for (const [name, data] of files) await atomicWrite(part(n.id, name), JSON.stringify(data, null, 2));
}

async function migrateIfNeeded(id: string): Promise<void> {
  const legacy = part(id, "novel.json");
  if ((await exists(part(id, "book.json"))) || !(await exists(legacy))) return;
  const raw = await readJSON<unknown>(legacy);
  if (!isV1(raw)) throw new Error("novel.json 格式无法识别");
  await writeParts(migrateV1(raw));
  await fs.rename(legacy, part(id, "novel.v1.backup.json"));
}

async function load(id: string): Promise<Novel> {
  await migrateIfNeeded(id);
  const book = await readJSON<BookFile>(part(id, "book.json"));
  if (!book) throw new Error("作品不存在");
  const bible = (await readJSON<BibleFile>(part(id, "bible.json"))) ?? { worldview: "", characters: [] };
  const structure = (await readJSON<StructureFile>(part(id, "structure.json"))) ?? { outline: "", arcs: [], chapters: [] };
  const memory = (await readJSON<Memory>(part(id, "memory.json"))) ?? emptyMemory();
  const inbox = (await readJSON<InboxFile>(part(id, "inbox.json"))) ?? { items: [] };
  return {
    ...book,
    settings: { ...DEFAULT_SETTINGS, ...book.settings },
    worldview: bible.worldview,
    characters: bible.characters,
    outline: structure.outline,
    arcs: structure.arcs,
    chapters: structure.chapters,
    memory: { ...emptyMemory(), ...memory },
    inbox: inbox.items,
  };
}

async function save(n: Novel): Promise<Novel> {
  const next = { ...n, updatedAt: Date.now() };
  await writeParts(next);
  return next;
}

export const store = {
  async list(): Promise<Novel[]> {
    await fs.mkdir(config.dataDir, { recursive: true });
    const ids = (await fs.readdir(config.dataDir)).filter((d) => /^[a-f0-9]{12}$/.test(d));
    const out: Novel[] = [];
    for (const id of ids) {
      try {
        out.push(await load(id));
      } catch {
        /* 跳过损坏或非作品目录 */
      }
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  },

  get: load,

  /** 读-改-写（带锁）。fn 返回新的作品对象，不要修改入参 */
  update(id: string, fn: (n: Novel) => Novel | Promise<Novel>): Promise<Novel> {
    return withLock(id, async () => save(await fn(await load(id))));
  },

  async create(input: Partial<Novel>): Promise<Novel> {
    const now = Date.now();
    const n: Novel = {
      schemaVersion: SCHEMA_VERSION,
      id: newId(),
      title: input.title?.trim() || "未命名作品",
      genre: input.genre || "玄幻",
      idea: input.idea || "",
      style: input.style || "",
      targetChapters: Math.max(1, Number(input.targetChapters) || 100),
      wordsPerChapter: Math.max(500, Number(input.wordsPerChapter) || 3000),
      worldview: "",
      outline: "",
      characters: [],
      arcs: [],
      chapters: [],
      memory: emptyMemory(),
      inbox: [],
      settings: { ...DEFAULT_SETTINGS },
      createdAt: now,
      updatedAt: now,
    };
    await writeParts(n);
    return n;
  },

  async remove(id: string) {
    await fs.rm(novelDir(id), { recursive: true, force: true });
  },

  // ---------------- 正文 ----------------
  async readChapter(id: string, index: number): Promise<string> {
    try {
      return await fs.readFile(chapterFile(id, index), "utf8");
    } catch {
      return "";
    }
  },

  /** 写入正文；如果已有正文且内容不同，先把旧版本存档 */
  async writeChapter(id: string, index: number, text: string, reason = "修改") {
    const old = await store.readChapter(id, index);
    if (old && old !== text) await history.saveVersion(id, index, old, reason);
    await atomicWrite(chapterFile(id, index), text);
  },

  async deleteChapterText(id: string, index: number) {
    await fs.rm(chapterFile(id, index), { force: true });
  },

  // ---------------- 历史版本 ----------------
  listVersions: history.listVersions,
  readVersion: history.readVersion,

  // ---------------- 记忆快照 ----------------
  async snapshot(id: string, reason: string) {
    const n = await load(id);
    const written = n.chapters.filter((c) => c.status === "written").length;
    await history.writeSnapshot(id, { reason, written, characters: n.characters, memory: n.memory });
  },

  listSnapshots: history.listSnapshots,

  /** 恢复人物与记忆到快照时的状态（正文不受影响）；恢复前先给当前状态拍一张快照 */
  async restoreSnapshot(id: string, file: string): Promise<Novel> {
    const data = await history.readSnapshot(id, file);
    await store.snapshot(id, "恢复快照前");
    return store.update(id, (n) => ({ ...n, characters: data.characters, memory: { ...emptyMemory(), ...data.memory } }));
  },

  // ---------------- 生产留档 ----------------
  async writeRun(id: string, index: number, name: string, data: unknown) {
    await atomicWrite(path.join(runDir(id, index), `${name}.json`), JSON.stringify(data, null, 2));
  },

  async readRun<T = unknown>(id: string, index: number, name: string): Promise<T | null> {
    if (!/^[\w-]+$/.test(name)) throw new Error("非法留档名");
    return readJSON<T>(path.join(runDir(id, index), `${name}.json`));
  },

  async listRuns(id: string, index: number): Promise<string[]> {
    try {
      return (await fs.readdir(runDir(id, index))).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
    } catch {
      return [];
    }
  },
};
