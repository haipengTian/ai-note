/**
 * v0.2（单文件 novel.json，无 schemaVersion）→ v2 数据迁移。纯函数，不修改入参。
 */
import {
  DEFAULT_SETTINGS,
  SCHEMA_VERSION,
  emptyState,
  type Chapter,
  type Character,
  type Hook,
  type Novel,
  type StateEvent,
} from "./types.js";
import { syncArcs } from "../state/arcs.js";

export interface NovelV1 {
  id: string;
  title: string;
  genre: string;
  idea: string;
  style: string;
  targetChapters: number;
  wordsPerChapter: number;
  worldview: string;
  characters: { id: string; name: string; role: string; profile: string; state: string }[];
  outline: string;
  chapters: (Omit<Chapter, "status"> & { status: "planned" | "written" })[];
  memory: {
    storySoFar: string;
    summarizedUpTo: number;
    foreshadows: { id: string; content: string; plantedIn: number; resolvedIn?: number }[];
  };
  settings?: { autoReview?: boolean; reviewThreshold?: number };
  createdAt: number;
  updatedAt: number;
}

export function isV1(raw: unknown): raw is NovelV1 {
  return typeof raw === "object" && raw !== null && !("schemaVersion" in raw);
}

const MIGRATED_EVIDENCE = "（迁移自 v0.2 的人物状态）";

export function migrateV1(old: NovelV1): Novel {
  const lastWritten = old.chapters.filter((c) => c.status === "written").at(-1)?.index ?? 0;
  const now = Date.now();

  const characters: Character[] = old.characters.map((c) => ({
    id: c.id,
    name: c.name,
    aliases: [],
    role: c.role,
    profile: c.profile,
    initial: {
      ...emptyState(),
      attrs: c.state && !lastWritten ? ({ 状态概述: c.state } as Record<string, string>) : {},
    },
    source: "migrated",
  }));

  const events: StateEvent[] = lastWritten
    ? old.characters
        .filter((c) => c.state)
        .map((c) => ({
          id: `m-${c.id}`,
          chapter: lastWritten,
          kind: "attr",
          target: c.id,
          key: "状态概述",
          op: "set",
          value: c.state,
          evidence: MIGRATED_EVIDENCE,
          critical: false,
          status: "applied",
          source: "migrated",
          createdAt: now,
        }))
    : [];

  const hooks: Hook[] = old.memory.foreshadows.map((f) => ({
    id: f.id,
    type: "foreshadow",
    content: f.content,
    importance: "minor",
    status: f.resolvedIn ? "resolved" : "open",
    plantedIn: f.plantedIn,
    resolvedIn: f.resolvedIn,
    history: [
      { chapter: f.plantedIn, op: "plant", note: "" },
      ...(f.resolvedIn ? [{ chapter: f.resolvedIn, op: "resolve" as const, note: "" }] : []),
    ],
    source: "migrated",
  }));

  const settings = { ...DEFAULT_SETTINGS, ...(old.settings ?? {}) };
  const chapters: Chapter[] = old.chapters.map((c) => ({ ...c, characters: [...c.characters] }));

  return {
    schemaVersion: SCHEMA_VERSION,
    id: old.id,
    title: old.title,
    genre: old.genre,
    idea: old.idea,
    style: old.style,
    targetChapters: old.targetChapters,
    wordsPerChapter: old.wordsPerChapter,
    worldview: old.worldview,
    outline: old.outline,
    characters,
    arcs: syncArcs([], chapters, settings.arcSize, old.targetChapters),
    chapters,
    memory: {
      events,
      hooks,
      secrets: [],
      bookSynopsis: old.memory.storySoFar,
      synopsisUpTo: old.memory.storySoFar ? old.memory.summarizedUpTo : 0,
    },
    inbox: [],
    settings,
    createdAt: old.createdAt,
    updatedAt: old.updatedAt,
  };
}
