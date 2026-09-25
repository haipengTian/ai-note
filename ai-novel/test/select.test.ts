import { test } from "node:test";
import assert from "node:assert/strict";
import { memoryLayers, selectCharacters, renderStates, chapterBlocks } from "../src/context/select.js";
import { syncArcs } from "../src/state/arcs.js";
import { emptyState, emptyMemory, DEFAULT_SETTINGS, type Chapter, type Character, type Novel } from "../src/model/types.js";

const ch = (index: number, over: Partial<Chapter> = {}): Chapter => ({
  index,
  title: `标题${index}`,
  outline: `大纲${index}`,
  characters: [],
  status: "written",
  summary: `摘要${index}`,
  words: 100,
  ...over,
});

const char = (id: string, name: string, over: Partial<Character> = {}): Character => ({
  id,
  name,
  aliases: [],
  role: "配角",
  profile: `${name}的设定`,
  initial: emptyState(),
  source: "manual",
  ...over,
});

function novel(over: Partial<Novel> = {}): Novel {
  const chapters = over.chapters ?? [];
  return {
    schemaVersion: 2,
    id: "abcdefabcdef",
    title: "书",
    genre: "玄幻",
    idea: "灵感",
    style: "",
    targetChapters: 100,
    wordsPerChapter: 3000,
    worldview: "世界观内容",
    outline: "总纲",
    characters: [char("c1", "林凡", { role: "主角" }), char("c2", "苏晴"), char("c3", "路人")],
    arcs: syncArcs([], chapters, 10, 100),
    chapters,
    memory: emptyMemory(),
    inbox: [],
    settings: DEFAULT_SETTINGS,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

test("memoryLayers：梗概覆盖的章节不再出现，已冻结弧用弧摘要，其余用章摘要", () => {
  const chapters = Array.from({ length: 34 }, (_, i) => ch(i + 1));
  const base = novel({ chapters });
  const n: Novel = {
    ...base,
    arcs: base.arcs.map((a) => (a.index === 2 ? { ...a, summary: "第二段摘要" } : a)),
    memory: { ...emptyMemory(), bookSynopsis: "梗概", synopsisUpTo: 10 },
  };
  const m = memoryLayers(n, 35);
  assert.equal(m.synopsis, "梗概");
  assert.deepEqual(
    m.arcSummaries.map((a) => a.index),
    [2],
  );
  assert.deepEqual(
    m.chapterSummaries.map((c) => c.index),
    [...Array.from({ length: 10 }, (_, i) => 21 + i), 31, 32, 33, 34],
  );
});

test("memoryLayers：只取第 N 章之前的内容", () => {
  const chapters = Array.from({ length: 5 }, (_, i) => ch(i + 1));
  const m = memoryLayers(novel({ chapters }), 3);
  assert.deepEqual(
    m.chapterSummaries.map((c) => c.index),
    [1, 2],
  );
});

test("selectCharacters：本章出场人物 + 主角，去掉尚未登场的", () => {
  const n = novel({
    characters: [
      char("c1", "林凡", { role: "主角" }),
      char("c2", "苏晴", { aliases: ["苏师姐"] }),
      char("c3", "路人"),
      char("c4", "后期反派", { source: "ai", firstAppearance: 50 }),
    ],
  });
  const picked = selectCharacters(n, ch(10, { characters: ["苏师姐", "后期反派"] }));
  assert.deepEqual(
    picked.map((c) => c.id),
    ["c1", "c2"],
  );
});

test("selectCharacters：章纲没写出场人物时取前 8 个已登场人物", () => {
  const picked = selectCharacters(novel(), ch(1, { characters: [] }));
  assert.equal(picked.length, 3);
});

test("renderStates：渲染属性、物品、关系、秘密和生死", () => {
  const n = novel({
    memory: {
      ...emptyMemory(),
      secrets: [{ id: "s1", content: "父亲还活着", knownToReader: true, createdIn: 1, source: "ai" }],
    },
  });
  const text = renderStates(n, [n.characters[0]], {
    c1: { attrs: { 境界: "炼气四层" }, relations: { c2: "师姐弟" }, knows: ["s1"], inventory: { 灵石: 300 }, alive: false },
  });
  assert.match(text, /境界：炼气四层/);
  assert.match(text, /灵石×300/);
  assert.match(text, /苏晴（师姐弟）/);
  assert.match(text, /父亲还活着/);
  assert.match(text, /已死亡/);
});

test("chapterBlocks：包含写作需要的全部块，本章大纲为 protected", () => {
  const chapters = [ch(1), ch(2), ch(3, { status: "planned", characters: ["苏晴"] })];
  const blocks = chapterBlocks(novel({ chapters }), 3, "上一章正文");
  const ids = blocks.map((b) => b.id);
  for (const id of ["header", "worldview", "profiles", "states", "hooks", "recent", "prev", "chapter"]) assert.ok(ids.includes(id), id);
  assert.equal(blocks.find((b) => b.id === "chapter")!.tier, "protected");
  assert.match(blocks.find((b) => b.id === "chapter")!.text, /大纲3/);
});
