import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveInbox, addManualEvent, setEventStatus } from "../src/state/inbox.js";
import { stateAt } from "../src/state/events.js";
import { emptyState, emptyMemory, DEFAULT_SETTINGS, type Chapter, type Novel, type StateEvent, type InboxItem } from "../src/model/types.js";

const ch = (index: number, stale?: string): Chapter => ({ index, title: "", outline: "", characters: [], status: "written", summary: "", words: 0, stale });

const proposal: StateEvent = {
  id: "e1",
  chapter: 3,
  kind: "attr",
  target: "c1",
  key: "境界",
  op: "set",
  value: "筑基",
  evidence: "突破筑基",
  critical: true,
  status: "proposed",
  source: "ai",
  createdAt: 1,
};

const item = (over: Partial<InboxItem>): InboxItem => ({
  id: "i1",
  kind: "state_proposal",
  chapter: 3,
  refId: "e1",
  title: "",
  detail: "",
  blocking: true,
  status: "open",
  createdAt: 0,
  ...over,
});

function novel(over: Partial<Novel> = {}): Novel {
  return {
    schemaVersion: 2, id: "abcdefabcdef", title: "", genre: "", idea: "", style: "", targetChapters: 100, wordsPerChapter: 3000,
    worldview: "", outline: "", arcs: [], chapters: [ch(1), ch(2), ch(3)],
    characters: [{ id: "c1", name: "林凡", aliases: [], role: "主角", profile: "", initial: emptyState(), source: "manual" }],
    memory: { ...emptyMemory(), events: [proposal] },
    inbox: [item({})],
    settings: DEFAULT_SETTINGS, createdAt: 0, updatedAt: 0,
    ...over,
  };
}

test("确认提案：事件生效，待办完成", () => {
  const n = resolveInbox(novel(), "i1", "approve");
  assert.equal(n.memory.events[0].status, "applied");
  assert.equal(n.inbox[0].status, "done");
  assert.equal(stateAt(n.characters, n.memory.events, 4)["c1"].attrs["境界"], "筑基");
});

test("拒绝提案：事件作废，待办完成", () => {
  const n = resolveInbox(novel(), "i1", "reject");
  assert.equal(n.memory.events[0].status, "rejected");
  assert.equal(n.inbox[0].status, "done");
});

test("确认提案时后续已写章节被标记为待复查", () => {
  const n = resolveInbox(novel({ chapters: [ch(1), ch(3), ch(4)] }), "i1", "approve");
  assert.ok(n.chapters.find((c) => c.index === 4)!.stale);
});

test("忽略“后续章节待复查”时清除对应章节的标记", () => {
  const base = novel({
    chapters: [ch(1), ch(2, "第 1 章重写后未复查"), ch(3, "第 2 章手动编辑后未复查")],
    inbox: [item({ id: "s1", kind: "stale_chapter", chapter: 1, refId: undefined, blocking: false })],
  });
  const n = resolveInbox(base, "s1", "dismiss");
  assert.equal(n.inbox[0].status, "dismissed");
  assert.equal(n.chapters[1].stale, undefined);
  assert.ok(n.chapters[2].stale, "其他章节引起的标记保留");
});

test("不存在的待办报错；已处理的不能重复处理", () => {
  assert.throws(() => resolveInbox(novel(), "nope", "approve"), /待办不存在/);
  const done = resolveInbox(novel(), "i1", "approve");
  assert.throws(() => resolveInbox(done, "i1", "reject"), /已处理/);
});

test("addManualEvent：手动修正立即生效，来源为 manual", () => {
  const n = addManualEvent(novel(), { chapter: 2, kind: "attr", target: "c1", key: "所在地", op: "set", value: "北冥", note: "" });
  const e = n.memory.events.at(-1)!;
  assert.equal(e.source, "manual");
  assert.equal(e.status, "applied");
  assert.equal(stateAt(n.characters, n.memory.events, 3)["c1"].attrs["所在地"], "北冥");
});

test("addManualEvent：人物不存在时报错", () => {
  assert.throws(() => addManualEvent(novel(), { chapter: 2, kind: "attr", target: "ghost", key: "x", op: "set", value: "y", note: "" }), /人物不存在/);
});

test("setEventStatus：修改事件状态并关闭关联待办", () => {
  const n = setEventStatus(novel(), "e1", "rejected");
  assert.equal(n.memory.events[0].status, "rejected");
  assert.equal(n.inbox[0].status, "done");
});
