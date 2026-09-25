/**
 * 章节历史版本与记忆快照。
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { Character, Memory } from "../model/types.js";
import { countWords } from "../util/text.js";
import { pruneDir, safeName, snapshotDir, versionDir } from "./files.js";

const MAX_VERSIONS = 20;
const MAX_SNAPSHOTS = 60;

export interface VersionInfo {
  file: string;
  at: number;
  reason: string;
  words: number;
}

export interface SnapshotInfo {
  file: string;
  at: number;
  reason: string;
  /** 快照时已写到第几章 */
  written: number;
}

export interface SnapshotData {
  at: number;
  reason: string;
  written: number;
  characters: Character[];
  memory: Memory;
}

// ------------------------------------------------------------------ 版本
export async function saveVersion(id: string, index: number, text: string, reason: string) {
  const d = versionDir(id, index);
  await fs.mkdir(d, { recursive: true });
  // 文件名：时间戳_字数_原因.txt（原因 = 被什么操作覆盖）
  await fs.writeFile(path.join(d, `${Date.now()}_${countWords(text)}_${safeName(reason)}.txt`), text, "utf8");
  await pruneDir(d, MAX_VERSIONS);
}

function parseName(file: string, ext: string) {
  const [at, num, ...rest] = file.slice(0, -ext.length).split("_");
  return { at: Number(at), num: Number(num), reason: rest.join("_") };
}

export async function listVersions(id: string, index: number): Promise<VersionInfo[]> {
  try {
    const files = (await fs.readdir(versionDir(id, index))).filter((f) => f.endsWith(".txt"));
    return files
      .map((file) => {
        const p = parseName(file, ".txt");
        return { file, at: p.at, words: p.num, reason: p.reason };
      })
      .sort((a, b) => b.at - a.at);
  } catch {
    return [];
  }
}

export async function readVersion(id: string, index: number, file: string): Promise<string> {
  if (!/^[\w一-龥-]+\.txt$/.test(file)) throw new Error("非法版本文件名");
  return fs.readFile(path.join(versionDir(id, index), file), "utf8");
}

// ------------------------------------------------------------------ 快照
export async function writeSnapshot(id: string, data: Omit<SnapshotData, "at">) {
  const d = snapshotDir(id);
  await fs.mkdir(d, { recursive: true });
  const at = Date.now();
  await fs.writeFile(path.join(d, `${at}_${data.written}_${safeName(data.reason)}.json`), JSON.stringify({ ...data, at }), "utf8");
  await pruneDir(d, MAX_SNAPSHOTS);
}

export async function listSnapshots(id: string): Promise<SnapshotInfo[]> {
  try {
    const files = (await fs.readdir(snapshotDir(id))).filter((f) => f.endsWith(".json"));
    return files
      .map((file) => {
        const p = parseName(file, ".json");
        return { file, at: p.at, written: p.num, reason: p.reason };
      })
      .sort((a, b) => b.at - a.at);
  } catch {
    return [];
  }
}

export async function readSnapshot(id: string, file: string): Promise<SnapshotData> {
  if (!/^[\w一-龥-]+\.json$/.test(file)) throw new Error("非法快照文件名");
  return JSON.parse(await fs.readFile(path.join(snapshotDir(id), file), "utf8"));
}
