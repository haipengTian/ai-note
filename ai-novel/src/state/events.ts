/**
 * 状态事件系统（事件溯源）：
 *   第 N 章开写前的状态 = 人物初始状态 + 所有 applied 且 chapter < N 的事件，按章节、创建时间顺序折叠。
 * 全部是纯函数，不修改入参。
 */
import type { Character, CharacterState, Novel, StateEvent } from "../model/types.js";
import { recomputeHook } from "./hooks.js";

export type WorldState = Record<string, CharacterState>;

const cloneState = (s: CharacterState): CharacterState => ({
  attrs: { ...s.attrs },
  relations: { ...s.relations },
  knows: [...s.knows],
  inventory: { ...s.inventory },
  alive: s.alive,
});

function omit<T>(rec: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _drop, ...rest } = rec;
  return rest;
}

/** 把一个事件应用到人物状态上，返回新状态 */
export function applyEvent(s: CharacterState, e: StateEvent): CharacterState {
  const key = e.key ?? "";
  switch (e.kind) {
    case "attr":
      return e.op === "remove" ? { ...s, attrs: omit(s.attrs, key) } : { ...s, attrs: { ...s.attrs, [key]: String(e.value ?? "") } };
    case "relation":
      return e.op === "remove"
        ? { ...s, relations: omit(s.relations, key) }
        : { ...s, relations: { ...s.relations, [key]: String(e.value ?? "") } };
    case "knowledge":
      if (e.op === "remove") return { ...s, knows: s.knows.filter((k) => k !== key) };
      return s.knows.includes(key) ? s : { ...s, knows: [...s.knows, key] };
    case "inventory": {
      if (e.op === "remove") return { ...s, inventory: omit(s.inventory, key) };
      const n = Number(e.value ?? 1);
      const qty = e.op === "set" ? n : (s.inventory[key] ?? 0) + (Number.isFinite(n) ? n : 1);
      return qty > 0 ? { ...s, inventory: { ...s.inventory, [key]: qty } } : { ...s, inventory: omit(s.inventory, key) };
    }
    case "life":
      return { ...s, alive: e.value !== "dead" };
  }
}

const byOrder = (a: StateEvent, b: StateEvent) => a.chapter - b.chapter || a.createdAt - b.createdAt;

/** 第 chapter 章开写前的所有人物状态（characterId -> 状态） */
export function stateAt(characters: Character[], events: StateEvent[], chapter: number): WorldState {
  const world: WorldState = Object.fromEntries(characters.map((c) => [c.id, cloneState(c.initial)]));
  const effective = events.filter((e) => e.status === "applied" && e.chapter < chapter).sort(byOrder);
  for (const e of effective) {
    const cur = world[e.target];
    if (cur) world[e.target] = applyEvent(cur, e);
  }
  return world;
}

/** 某个人物的全部事件（时间线视图用） */
export function eventsOf(events: StateEvent[], characterId: string): StateEvent[] {
  return events.filter((e) => e.target === characterId).sort(byOrder);
}

/**
 * 撤销第 index 章由 AI 产生的全部记忆（重写/删除章节、重新整理记忆前调用）：
 * AI 事件、AI 新增的秘密、伏笔操作记录、未被其他章引用的 AI 新人物、该章的待确认提案。
 * 手动添加的事件保留。
 */
export function revertChapter(n: Novel, index: number): Novel {
  const events = n.memory.events.filter((e) => !(e.chapter === index && e.source === "ai"));
  // 关系事件的 key 也是 characterId，被引用的人物不能删
  const referenced = new Set(events.flatMap((e) => (e.kind === "relation" && e.key ? [e.target, e.key] : [e.target])));
  const characters = n.characters.filter(
    (c) => !(c.source === "ai" && c.firstAppearance === index && !referenced.has(c.id)),
  );
  const hooks = n.memory.hooks
    .filter((h) => !(h.plantedIn === index && h.source === "ai"))
    .map((h) => recomputeHook({ ...h, history: h.history.filter((r) => !(r.chapter === index && r.source === "ai")) }));
  const secrets = n.memory.secrets.filter((s) => !(s.createdIn === index && s.source === "ai"));
  const inbox = n.inbox.map((i) =>
    i.kind === "state_proposal" && i.chapter === index && i.status === "open" ? { ...i, status: "dismissed" as const } : i,
  );
  return { ...n, characters, memory: { ...n.memory, events, hooks, secrets }, inbox };
}
