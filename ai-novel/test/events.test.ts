import { test } from "node:test";
import assert from "node:assert/strict";
import { stateAt, applyEvent, revertChapter } from "../src/state/events.js";
import { emptyState, emptyMemory, DEFAULT_SETTINGS, type Character, type StateEvent, type Novel } from "../src/model/types.js";

const char = (id: string, name: string, over: Partial<Character> = {}): Character => ({
  id,
  name,
  aliases: [],
  role: "配角",
  profile: "",
  initial: emptyState(),
  source: "manual",
  ...over,
});

let seq = 0;
const ev = (over: Partial<StateEvent>): StateEvent => ({
  id: `e${++seq}`,
  chapter: 1,
  kind: "attr",
  target: "c1",
  op: "set",
  evidence: "证据",
  critical: false,
  status: "applied",
  source: "ai",
  createdAt: seq,
  ...over,
});

test("applyEvent：attr 设置与删除，不修改入参", () => {
  const s0 = emptyState();
  const s1 = applyEvent(s0, ev({ key: "境界", value: "炼气三层" }));
  assert.equal(s1.attrs["境界"], "炼气三层");
  assert.deepEqual(s0.attrs, {});
  const s2 = applyEvent(s1, ev({ key: "境界", op: "remove" }));
  assert.equal(s2.attrs["境界"], undefined);
});

test("applyEvent：物品数量增减，归零即移除", () => {
  let s = applyEvent(emptyState(), ev({ kind: "inventory", key: "灵石", op: "add", value: 500 }));
  s = applyEvent(s, ev({ kind: "inventory", key: "灵石", op: "add", value: -200 }));
  assert.equal(s.inventory["灵石"], 300);
  s = applyEvent(s, ev({ kind: "inventory", key: "灵石", op: "add", value: -300 }));
  assert.equal("灵石" in s.inventory, false);
  s = applyEvent(s, ev({ kind: "inventory", key: "玉佩", op: "add" }));
  assert.equal(s.inventory["玉佩"], 1);
});

test("applyEvent：关系、信息差、生死", () => {
  let s = applyEvent(emptyState(), ev({ kind: "relation", key: "c2", value: "师徒" }));
  s = applyEvent(s, ev({ kind: "knowledge", key: "sec1", op: "add" }));
  s = applyEvent(s, ev({ kind: "knowledge", key: "sec1", op: "add" }));
  s = applyEvent(s, ev({ kind: "life", op: "set", value: "dead" }));
  assert.equal(s.relations["c2"], "师徒");
  assert.deepEqual(s.knows, ["sec1"]);
  assert.equal(s.alive, false);
});

test("stateAt 只折叠第 N 章之前、已生效的事件", () => {
  const chars = [char("c1", "林凡", { initial: { ...emptyState(), attrs: { 境界: "凡人" } } })];
  const events = [
    ev({ chapter: 1, key: "境界", value: "炼气一层" }),
    ev({ chapter: 3, key: "境界", value: "炼气三层" }),
    ev({ chapter: 2, key: "所在地", value: "青云宗", status: "proposed" }),
    ev({ chapter: 2, key: "伤势", value: "左臂骨折", status: "rejected" }),
  ];
  assert.equal(stateAt(chars, events, 1)["c1"].attrs["境界"], "凡人");
  assert.equal(stateAt(chars, events, 2)["c1"].attrs["境界"], "炼气一层");
  assert.equal(stateAt(chars, events, 4)["c1"].attrs["境界"], "炼气三层");
  assert.equal(stateAt(chars, events, 4)["c1"].attrs["所在地"], undefined);
  assert.equal(stateAt(chars, events, 4)["c1"].attrs["伤势"], undefined);
});

test("stateAt 同一章按创建顺序折叠，忽略未知人物", () => {
  const chars = [char("c1", "林凡")];
  const events = [
    ev({ chapter: 1, key: "境界", value: "B", createdAt: 20 }),
    ev({ chapter: 1, key: "境界", value: "A", createdAt: 10 }),
    ev({ chapter: 1, target: "ghost", key: "x", value: "y" }),
  ];
  const w = stateAt(chars, events, 2);
  assert.equal(w["c1"].attrs["境界"], "B");
  assert.equal(w["ghost"], undefined);
});

function novel(over: Partial<Novel> = {}): Novel {
  return {
    schemaVersion: 2,
    id: "abcdefabcdef",
    title: "t",
    genre: "玄幻",
    idea: "",
    style: "",
    targetChapters: 100,
    wordsPerChapter: 3000,
    worldview: "",
    outline: "",
    characters: [char("c1", "林凡")],
    arcs: [],
    chapters: [],
    memory: emptyMemory(),
    inbox: [],
    settings: DEFAULT_SETTINGS,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

test("revertChapter 撤销该章 AI 事件，保留手动修正与其他章", () => {
  const n = novel({
    memory: {
      ...emptyMemory(),
      events: [
        ev({ id: "keep1", chapter: 1, key: "a", value: "1" }),
        ev({ id: "drop", chapter: 2, key: "a", value: "2" }),
        ev({ id: "manual", chapter: 2, key: "b", value: "x", source: "manual" }),
      ],
    },
  });
  const r = revertChapter(n, 2);
  assert.deepEqual(
    r.memory.events.map((e) => e.id),
    ["keep1", "manual"],
  );
  assert.equal(n.memory.events.length, 3);
});

test("revertChapter 移除该章 AI 新增的秘密和未被其他章引用的新人物", () => {
  const n = novel({
    characters: [
      char("c1", "林凡"),
      char("c2", "路人甲", { source: "ai", firstAppearance: 2 }),
      char("c3", "王长老", { source: "ai", firstAppearance: 2 }),
    ],
    memory: {
      ...emptyMemory(),
      secrets: [
        { id: "s1", content: "身世", knownToReader: true, createdIn: 2, source: "ai" },
        { id: "s2", content: "早期秘密", knownToReader: true, createdIn: 1, source: "ai" },
      ],
      events: [ev({ chapter: 3, target: "c3", key: "所在地", value: "后山" })],
    },
  });
  const r = revertChapter(n, 2);
  assert.deepEqual(
    r.characters.map((c) => c.id),
    ["c1", "c3"],
  );
  assert.deepEqual(
    r.memory.secrets.map((s) => s.id),
    ["s2"],
  );
});

test("revertChapter 撤销伏笔操作并重新计算伏笔状态，关闭该章待确认提案", () => {
  const n = novel({
    memory: {
      ...emptyMemory(),
      hooks: [
        {
          id: "h1",
          type: "foreshadow",
          content: "玉佩",
          importance: "major",
          status: "resolved",
          plantedIn: 1,
          resolvedIn: 2,
          lastAdvancedIn: 2,
          history: [
            { chapter: 1, op: "plant", note: "", source: "ai" },
            { chapter: 2, op: "resolve", note: "", source: "ai" },
          ],
          source: "ai",
        },
        { id: "h2", type: "mystery", content: "新坑", importance: "minor", status: "open", plantedIn: 2, history: [{ chapter: 2, op: "plant", note: "" }], source: "ai" },
      ],
    },
    inbox: [
      { id: "i1", kind: "state_proposal", chapter: 2, title: "", detail: "", blocking: true, status: "open", createdAt: 0 },
      { id: "i2", kind: "state_proposal", chapter: 1, title: "", detail: "", blocking: true, status: "open", createdAt: 0 },
    ],
  });
  const r = revertChapter(n, 2);
  assert.deepEqual(
    r.memory.hooks.map((h) => h.id),
    ["h1"],
  );
  assert.equal(r.memory.hooks[0].status, "open");
  assert.equal(r.memory.hooks[0].resolvedIn, undefined);
  assert.equal(r.inbox.find((i) => i.id === "i1")!.status, "dismissed");
  assert.equal(r.inbox.find((i) => i.id === "i2")!.status, "open");
});

test("revertChapter 不删除被其他章关系事件引用的 AI 新人物", () => {
  const n = novel({
    characters: [char("c1", "林凡"), char("c5", "新人物", { source: "ai", firstAppearance: 5 })],
    memory: { ...emptyMemory(), events: [ev({ chapter: 10, target: "c1", kind: "relation", key: "c5", value: "朋友" })] },
  });
  assert.deepEqual(
    revertChapter(n, 5).characters.map((c) => c.id),
    ["c1", "c5"],
  );
});

test("revertChapter 保留伏笔历史中的手动记录", () => {
  const n = novel({
    memory: {
      ...emptyMemory(),
      hooks: [
        {
          id: "h1", type: "foreshadow", content: "玉佩", importance: "major", status: "resolved", plantedIn: 1, resolvedIn: 7,
          history: [
            { chapter: 1, op: "plant", note: "", source: "ai" },
            { chapter: 7, op: "advance", note: "", source: "ai" },
            { chapter: 7, op: "resolve", note: "手动标记", source: "manual" },
          ],
          source: "ai",
        },
      ],
    },
  });
  const h = revertChapter(n, 7).memory.hooks[0];
  assert.deepEqual(h.history.map((r) => r.op), ["plant", "resolve"]);
  assert.equal(h.status, "resolved");
});
