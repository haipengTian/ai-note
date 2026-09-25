import { test } from "node:test";
import assert from "node:assert/strict";
import { migrateV1, isV1, type NovelV1 } from "../src/model/migrate.js";

function v1(over: Partial<NovelV1> = {}): NovelV1 {
  return {
    id: "abcdefabcdef",
    title: "测试书",
    genre: "玄幻",
    idea: "灵感",
    style: "热血",
    targetChapters: 100,
    wordsPerChapter: 3000,
    worldview: "世界观",
    characters: [
      { id: "c1", name: "林凡", role: "主角", profile: "少年", state: "炼气三层，在青云宗" },
      { id: "c2", name: "苏晴", role: "女主", profile: "师姐", state: "" },
    ],
    outline: "总纲",
    chapters: [
      { index: 1, title: "开端", outline: "o1", characters: ["林凡"], status: "written", summary: "s1", words: 3000 },
      { index: 2, title: "风起", outline: "o2", characters: [], status: "written", summary: "s2", words: 3100 },
      { index: 3, title: "未写", outline: "o3", characters: [], status: "planned", summary: "", words: 0 },
    ],
    memory: {
      storySoFar: "前情",
      summarizedUpTo: 1,
      foreshadows: [
        { id: "ab12cd", content: "神秘玉佩", plantedIn: 1 },
        { id: "ef34gh", content: "师父失踪", plantedIn: 1, resolvedIn: 2 },
      ],
    },
    settings: { autoReview: false, reviewThreshold: 75 },
    createdAt: 1,
    updatedAt: 2,
    ...over,
  };
}

test("isV1 按 schemaVersion 判断", () => {
  assert.equal(isV1(v1()), true);
  assert.equal(isV1({ schemaVersion: 2 }), false);
});

test("迁移保留基本信息和设置", () => {
  const n = migrateV1(v1());
  assert.equal(n.schemaVersion, 2);
  assert.equal(n.title, "测试书");
  assert.equal(n.worldview, "世界观");
  assert.equal(n.outline, "总纲");
  assert.equal(n.settings.autoReview, false);
  assert.equal(n.settings.reviewThreshold, 75);
  assert.equal(n.settings.confirmCritical, true);
  assert.deepEqual(n.inbox, []);
});

test("人物旧状态文本变成最后已写章节上的状态事件", () => {
  const n = migrateV1(v1());
  const lin = n.characters.find((c) => c.name === "林凡")!;
  assert.deepEqual(lin.initial.attrs, {});
  assert.equal(lin.source, "migrated");
  assert.equal(n.memory.events.length, 1);
  const e = n.memory.events[0];
  assert.equal(e.target, "c1");
  assert.equal(e.kind, "attr");
  assert.equal(e.key, "状态概述");
  assert.equal(e.value, "炼气三层，在青云宗");
  assert.equal(e.chapter, 2);
  assert.equal(e.status, "applied");
});

test("没有已写章节时旧状态放进初始状态", () => {
  const n = migrateV1(v1({ chapters: [] }));
  const lin = n.characters.find((c) => c.name === "林凡")!;
  assert.equal(lin.initial.attrs["状态概述"], "炼气三层，在青云宗");
  assert.equal(n.memory.events.length, 0);
});

test("伏笔迁移为 hooks，保留 id 和回收状态", () => {
  const n = migrateV1(v1());
  const [a, b] = n.memory.hooks;
  assert.equal(a.id, "ab12cd");
  assert.equal(a.status, "open");
  assert.equal(a.importance, "minor");
  assert.deepEqual(a.history, [{ chapter: 1, op: "plant", note: "" }]);
  assert.equal(b.status, "resolved");
  assert.equal(b.resolvedIn, 2);
  assert.equal(b.history.at(-1)!.op, "resolve");
});

test("前情提要变成全书梗概，并按章节生成剧情弧", () => {
  const n = migrateV1(v1());
  assert.equal(n.memory.bookSynopsis, "前情");
  assert.equal(n.memory.synopsisUpTo, 1);
  assert.equal(n.arcs.length, 1);
  assert.deepEqual(n.arcs[0].range, [1, 10]);
  assert.equal(n.arcs[0].status, "writing");
});

test("迁移不修改输入对象", () => {
  const input = v1();
  const copy = structuredClone(input);
  migrateV1(input);
  assert.deepEqual(input, copy);
});
