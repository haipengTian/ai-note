/**
 * 章后记忆回写（纯函数）：把模型抽取的结果校验后合并进作品。
 * - 每条状态变化必须附正文原句，找不到出处的视为编造，丢弃
 * - 人名通过姓名/别名解析为 characterId，解析不到的丢弃
 * - 关键变化（境界、身份、生死）在需要人工确认时生成提案，进入收件箱
 * 调用前应先 revertChapter()，保证同一章不会重复叠加。
 */
import crypto from "node:crypto";
import type { Character, EventKind, EventOp, InboxItem, Novel, Secret, StateEvent } from "../model/types.js";
import { emptyState } from "../model/types.js";
import type { Digest, DigestEventInput } from "../model/schemas.js";
import { stateAt } from "./events.js";
import { applyHookOp } from "./hooks.js";

const newId = () => crypto.randomBytes(6).toString("hex");

// ------------------------------------------------------------------ 证据校验
const normalize = (s: string) => s.replace(/[\s\p{P}\p{S}]/gu, "");

function ngrams(s: string, n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i + n <= s.length; i++) out.push(s.slice(i, i + n));
  return out;
}

/** 证据是否出自正文：去掉空白标点后是子串，或 3-gram 覆盖率 ≥ 60%（容忍轻微改写） */
export function evidenceMatches(text: string, evidence: string): boolean {
  const e = normalize(evidence);
  if (e.length < 2) return false;
  const t = normalize(text);
  if (t.includes(e)) return true;
  if (e.length < 6) return false;
  const grams = ngrams(e, 3);
  const pool = new Set(ngrams(t, 3));
  return grams.filter((g) => pool.has(g)).length / grams.length >= 0.6;
}

// ------------------------------------------------------------------ 关键变化
const CRITICAL_ATTR = /境界|等级|修为|实力|身份|职位|血脉|体质/;

export function isCritical(e: { kind: EventKind; key?: string; op: EventOp }): boolean {
  if (e.kind === "life") return true;
  return e.kind === "attr" && CRITICAL_ATTR.test(e.key ?? "");
}

// ------------------------------------------------------------------ 人名解析
export function resolveCharacter(characters: Character[], name: string): Character | undefined {
  const q = name.trim();
  if (!q) return undefined;
  return (
    characters.find((c) => c.name === q || c.aliases.includes(q)) ??
    characters.find((c) => q.length >= 2 && c.name.length >= 2 && (c.name.includes(q) || q.includes(c.name)))
  );
}

export interface DigestResult {
  novel: Novel;
  applied: number;
  proposed: number;
  /** 被丢弃的条目及原因（写日志） */
  dropped: string[];
  /** 人类可读的变化摘要（写日志） */
  changes: string[];
}

const LIFE_DEAD = /dead|死/;

function describe(e: StateEvent, name: (id: string) => string): string {
  const who = name(e.target);
  switch (e.kind) {
    case "attr":
      return e.op === "remove" ? `${who}：移除「${e.key}」` : `${who}：${e.key} → ${e.value}`;
    case "relation":
      return `${who} 与 ${name(e.key ?? "")}：${e.op === "remove" ? "关系解除" : e.value}`;
    case "knowledge":
      return `${who} ${e.op === "remove" ? "遗忘" : "得知"}秘密`;
    case "inventory": {
      if (e.op === "remove") return `${who}：失去全部${e.key}`;
      if (e.op === "set") return `${who}：${e.key} = ${e.value}`;
      const n = Number(e.value ?? 1);
      return `${who}：${e.key} ${n >= 0 ? "+" : ""}${n}`;
    }
    case "life":
      return `${who}：${e.value === "dead" ? "死亡" : "复活/存活"}`;
  }
}

export function applyDigest(n: Novel, index: number, d: Digest, text: string, now = Date.now()): DigestResult {
  const dropped: string[] = [];
  const changes: string[] = [];
  let seq = 0;

  // 1. 新人物（重名/别名命中的跳过）
  let characters = n.characters;
  for (const nc of d.newCharacters) {
    if (resolveCharacter(characters, nc.name)) continue;
    const c: Character = {
      id: newId(),
      name: nc.name.trim(),
      aliases: nc.aliases,
      role: nc.role || "配角",
      profile: nc.profile,
      initial: { ...emptyState(), attrs: nc.attrs },
      firstAppearance: index,
      source: "ai",
    };
    characters = [...characters, c];
    changes.push(`新人物 ${c.name}`);
  }
  const nameOf = (id: string) => characters.find((c) => c.id === id)?.name ?? id;

  // 2. 新秘密
  const refToSecret = new Map<string, string>();
  const newSecrets: Secret[] = d.newSecrets.map((s) => {
    const id = newId();
    refToSecret.set(s.ref, id);
    return { id, content: s.content, knownToReader: s.knownToReader, createdIn: index, source: "ai" };
  });
  const secretIds = new Set([...n.memory.secrets.map((s) => s.id), ...newSecrets.map((s) => s.id)]);

  // 3. 状态事件
  const events: StateEvent[] = [...n.memory.events];
  const inbox: InboxItem[] = [...n.inbox];
  let applied = 0;
  let proposed = 0;
  for (const raw of d.events) {
    const built = buildEvent(raw);
    if (typeof built === "string") {
      dropped.push(built);
      continue;
    }
    const critical = isCritical(built);
    const status = critical && n.settings.confirmCritical ? "proposed" : "applied";
    const e: StateEvent = { ...built, id: newId(), chapter: index, critical, status, source: "ai", createdAt: now + seq++ };
    events.push(e);
    const desc = describe(e, nameOf);
    if (status === "proposed") {
      proposed++;
      inbox.push({
        id: newId(),
        kind: "state_proposal",
        chapter: index,
        refId: e.id,
        title: `第 ${index} 章 · ${desc}`,
        detail: `原文：「${e.evidence}」`,
        blocking: true,
        status: "open",
        createdAt: now,
      });
      changes.push(`待确认：${desc}`);
    } else {
      applied++;
      changes.push(desc);
    }
  }

  function buildEvent(raw: DigestEventInput): Omit<StateEvent, "id" | "chapter" | "critical" | "status" | "source" | "createdAt"> | string {
    const label = `${raw.character}/${raw.kind}/${raw.key}`;
    const target = resolveCharacter(characters, raw.character);
    if (!target) return `未知人物：${label}`;
    if (!evidenceMatches(text, raw.evidence)) return `证据与正文不符：${label}「${raw.evidence.slice(0, 40)}」`;
    let key: string | undefined = raw.key.trim() || undefined;
    let value = raw.value;
    switch (raw.kind) {
      case "attr":
        if (!key) return `缺少属性名：${label}`;
        value = String(value ?? "");
        break;
      case "inventory": {
        if (!key) return `缺少物品名：${label}`;
        if (raw.op === "remove") {
          value = undefined;
          break;
        }
        const qty = value === undefined ? 1 : Number(value);
        if (!Number.isFinite(qty)) return `物品数量不是数字：${label}`;
        value = qty;
        break;
      }
      case "relation": {
        const other = resolveCharacter(characters, key ?? "");
        if (!other || other.id === target.id) return `关系对象未知：${label}`;
        key = other.id;
        break;
      }
      case "knowledge": {
        const id = refToSecret.get(key ?? "") ?? key?.replace(/[[\]\s]/g, "");
        if (!id || !secretIds.has(id)) return `秘密未知：${label}`;
        key = id;
        break;
      }
      case "life":
        key = undefined;
        value = LIFE_DEAD.test(String(value ?? "")) ? "dead" : "alive";
        break;
    }
    if (raw.kind === "attr" || raw.kind === "relation") {
      const cur = stateAt(characters, events, index + 1)[target.id];
      const current = raw.kind === "attr" ? cur?.attrs[key!] : cur?.relations[key!];
      if (raw.op !== "remove" && current === String(value ?? "")) return `与当前状态相同：${label}`;
    }
    return { kind: raw.kind, target: target.id, key, op: raw.op, value, evidence: raw.evidence.trim() };
  }

  // 4. 伏笔
  let hooks = n.memory.hooks;
  for (const h of d.hooks) {
    if (h.op === "plant") {
      if (!h.content) {
        dropped.push("伏笔缺少内容");
        continue;
      }
      hooks = applyHookOp(hooks, { op: "plant", content: h.content, type: h.type, importance: h.importance, note: h.note }, index, "ai");
      changes.push(`新伏笔：${h.content}`);
      continue;
    }
    const id = (h.id ?? "").replace(/[[\]\s]/g, "");
    if (!hooks.some((x) => x.id === id)) {
      dropped.push(`伏笔 id 不存在：${h.id}`);
      continue;
    }
    hooks = applyHookOp(hooks, { op: h.op, id, note: h.note }, index, "ai");
    changes.push(`${h.op === "resolve" ? "回收" : "推进"}伏笔：${hooks.find((x) => x.id === id)!.content}`);
  }

  const chapters = n.chapters.map((c) => (c.index === index ? { ...c, summary: d.summary.trim() || c.summary } : c));
  const novel: Novel = {
    ...n,
    characters,
    chapters,
    memory: { ...n.memory, events, hooks, secrets: [...n.memory.secrets, ...newSecrets] },
    inbox,
  };
  return { novel, applied, proposed, dropped, changes };
}
