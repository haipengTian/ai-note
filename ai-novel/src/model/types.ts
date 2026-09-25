/**
 * 数据模型 v2（设计见 docs/roadmap.md 第 2 节）。
 *
 * 核心变化：人物状态不再是一段会被覆盖的文字，而是「初始状态 + 按章的状态事件」，
 * 当前状态由 state/events.ts 的 stateAt() 推导。
 * 本文件只包含 P0 需要的字段；规则包、文风卡、分卷等在后续阶段加入。
 */

export const SCHEMA_VERSION = 2;

// ------------------------------------------------------------------ 人物
export interface CharacterState {
  /** 自由键值：境界、身份、所在地、伤势…… */
  attrs: Record<string, string>;
  /** 对方 characterId -> 关系描述 */
  relations: Record<string, string>;
  /** 掌握的秘密 id */
  knows: string[];
  /** 物品/资源 -> 数量 */
  inventory: Record<string, number>;
  alive: boolean;
}

export type Source = "ai" | "manual" | "migrated";

export interface Character {
  id: string;
  name: string;
  aliases: string[];
  /** 主角 / 女主 / 伙伴 / 导师 / 反派 / 配角 ... */
  role: string;
  /** 固定设定：身份、外貌、性格、背景、动机、说话方式 */
  profile: string;
  /** 故事开始（或首次登场）时的状态 */
  initial: CharacterState;
  /** 首次登场章节；AI 在章后抽取中新增的人物才有 */
  firstAppearance?: number;
  source: Source;
}

// ------------------------------------------------------------------ 状态事件
export type EventKind = "attr" | "relation" | "knowledge" | "inventory" | "life";
export type EventOp = "set" | "add" | "remove";
export type EventStatus = "applied" | "proposed" | "rejected";

export interface StateEvent {
  id: string;
  /** 发生在第几章（该章写完后生效） */
  chapter: number;
  kind: EventKind;
  /** characterId */
  target: string;
  /**
   * attr: 属性名；relation: 对方 characterId；knowledge: secretId；inventory: 物品名；life: 不用
   */
  key?: string;
  op: EventOp;
  value?: string | number;
  /** 正文原句，用于校验与追溯 */
  evidence: string;
  /** 关键变化（境界突破、死亡、秘密揭晓等）需要人工确认 */
  critical: boolean;
  status: EventStatus;
  source: Source;
  createdAt: number;
}

// ------------------------------------------------------------------ 伏笔 / 秘密
export type HookType = "foreshadow" | "mystery" | "promise" | "conflict";
export type HookStatus = "open" | "progressing" | "deferred" | "resolved" | "abandoned";
export type HookOp = "plant" | "advance" | "resolve";

export interface HookRecord {
  chapter: number;
  op: HookOp;
  note: string;
  /** 撤销某章记忆时只删 AI 产生的记录；旧数据没有该字段，视为非 AI 保留 */
  source?: Source;
}

export interface Hook {
  id: string;
  type: HookType;
  content: string;
  importance: "major" | "minor";
  status: HookStatus;
  plantedIn: number;
  lastAdvancedIn?: number;
  resolvedIn?: number;
  /** 计划回收区间 */
  payoffWindow?: [number, number];
  history: HookRecord[];
  source: Source;
}

export interface Secret {
  id: string;
  content: string;
  /** 读者是否已经知道 */
  knownToReader: boolean;
  createdIn: number;
  source: Source;
}

export interface Memory {
  events: StateEvent[];
  hooks: Hook[];
  secrets: Secret[];
  /** 全书梗概：由已冻结的弧摘要合并而来 */
  bookSynopsis: string;
  /** bookSynopsis 覆盖到第几章 */
  synopsisUpTo: number;
}

// ------------------------------------------------------------------ 结构
export interface Arc {
  id: string;
  index: number;
  title: string;
  range: [number, number];
  /** 弧结束后生成并冻结，不再自动改写 */
  summary?: string;
  status: "planned" | "writing" | "done";
}

// ------------------------------------------------------------------ 审校
export interface ReviewIssue {
  /** 审校维度，如 设定一致性 / 人物逻辑 / 大纲执行 / 衔接 / 节奏爽点 / 章末钩子 / AI腔 / 对话 */
  dimension: string;
  severity: "high" | "medium" | "low";
  quote: string;
  problem: string;
  suggestion: string;
}

export interface Review {
  score: number;
  verdict: "pass" | "revise";
  issues: ReviewIssue[];
  strengths: string[];
  aiPhrases: { phrase: string; count: number }[];
  revised: boolean;
  at: number;
}

// ------------------------------------------------------------------ 章节
export interface Chapter {
  index: number;
  title: string;
  outline: string;
  /** 本章出场人物名 */
  characters: string[];
  status: "planned" | "written" | "needs_attention";
  summary: string;
  words: number;
  updatedAt?: number;
  review?: Review;
  /** 上游章节改动后，本章可能与前文不一致时的说明 */
  stale?: string;
}

// ------------------------------------------------------------------ 收件箱
export type InboxKind = "state_proposal" | "stale_chapter" | "needs_digest" | "gate_failed";

export interface InboxItem {
  id: string;
  kind: InboxKind;
  chapter?: number;
  /** 关联对象 id，如 StateEvent.id */
  refId?: string;
  title: string;
  detail: string;
  /** 未处理时是否阻塞连续写作 */
  blocking: boolean;
  status: "open" | "done" | "dismissed";
  createdAt: number;
}

// ------------------------------------------------------------------ 作品
export interface NovelSettings {
  autoReview: boolean;
  reviewThreshold: number;
  /** 关键状态变化是否需要人工确认 */
  confirmCritical: boolean;
  /** P0 阶段每个剧情弧的章数（P1 起由弧规划决定） */
  arcSize: number;
}

export const DEFAULT_SETTINGS: NovelSettings = {
  autoReview: true,
  reviewThreshold: 80,
  confirmCritical: true,
  arcSize: 10,
};

export interface Novel {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  title: string;
  genre: string;
  idea: string;
  style: string;
  targetChapters: number;
  wordsPerChapter: number;
  worldview: string;
  outline: string;
  characters: Character[];
  arcs: Arc[];
  chapters: Chapter[];
  memory: Memory;
  inbox: InboxItem[];
  settings: NovelSettings;
  createdAt: number;
  updatedAt: number;
}

export const emptyState = (): CharacterState => ({ attrs: {}, relations: {}, knows: [], inventory: {}, alive: true });

export const emptyMemory = (): Memory => ({ events: [], hooks: [], secrets: [], bookSynopsis: "", synopsisUpTo: 0 });
