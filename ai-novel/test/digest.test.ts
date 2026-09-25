import { test } from "node:test";
import assert from "node:assert/strict";
import { evidenceMatches, applyDigest, isCritical } from "../src/state/digest.js";
import { parseDigest } from "../src/model/schemas.js";
import { stateAt } from "../src/state/events.js";
import { emptyState, emptyMemory, DEFAULT_SETTINGS, type Character, type Novel } from "../src/model/types.js";

const TEXT = `林凡握紧拳头，体内灵气翻涌，终于突破到了炼气四层。
苏晴递给他一枚玉佩：“这是你父亲留下的。”
林凡收下玉佩，又从储物袋里取出五百块灵石交给了王掌柜。
王掌柜低声说：“其实你父亲还活着，就在北冥。”`;

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
    characters: [
      char("c1", "林凡", { role: "主角", initial: { ...emptyState(), attrs: { 境界: "炼气三层" }, inventory: { 灵石: 800 } } }),
      char("c2", "苏晴", { aliases: ["苏师姐"] }),
    ],
    arcs: [],
    chapters: [{ index: 5, title: "突破", outline: "", characters: [], status: "written", summary: "", words: 100 }],
    memory: emptyMemory(),
    inbox: [],
    settings: DEFAULT_SETTINGS,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

test("evidenceMatches：忽略空白标点，允许轻微改写", () => {
  assert.equal(evidenceMatches(TEXT, "终于突破到了炼气四层"), true);
  assert.equal(evidenceMatches(TEXT, "苏晴递给他一枚玉佩，“这是你父亲留下的”"), true);
  assert.equal(evidenceMatches(TEXT, "林凡收下了玉佩，又从储物袋中取出五百块灵石交给王掌柜"), true);
  assert.equal(evidenceMatches(TEXT, "林凡被人一剑刺穿了胸口"), false);
  assert.equal(evidenceMatches(TEXT, ""), false);
});

test("parseDigest 容错：丢弃非法条目、补默认值、数字字符串转数字", () => {
  const d = parseDigest({
    summary: "摘要",
    events: [
      { character: "林凡", kind: "inventory", key: "灵石", op: "add", value: "-500", evidence: "五百块灵石" },
      { character: "林凡", kind: "飞升", evidence: "x" },
      "垃圾",
    ],
  });
  assert.equal(d.summary, "摘要");
  assert.equal(d.events.length, 1);
  assert.equal(d.events[0].value, -500);
  assert.deepEqual(d.hooks, []);
  assert.deepEqual(d.newCharacters, []);
});

test("isCritical：境界变化与死亡属于关键变化", () => {
  assert.equal(isCritical({ kind: "attr", key: "境界", op: "set" }), true);
  assert.equal(isCritical({ kind: "life", op: "set" }), true);
  assert.equal(isCritical({ kind: "attr", key: "所在地", op: "set" }), false);
});

test("applyDigest：写入摘要，普通变化直接生效，关键变化生成提案", () => {
  const d = parseDigest({
    summary: "林凡突破炼气四层，得知父亲下落。",
    events: [
      { character: "林凡", kind: "attr", key: "境界", op: "set", value: "炼气四层", evidence: "终于突破到了炼气四层" },
      { character: "林凡", kind: "inventory", key: "玉佩", op: "add", value: 1, evidence: "林凡收下玉佩" },
      { character: "林凡", kind: "inventory", key: "灵石", op: "add", value: -500, evidence: "取出五百块灵石交给了王掌柜" },
    ],
  });
  const r = applyDigest(novel(), 5, d, TEXT, 1000);
  const n = r.novel;
  assert.equal(n.chapters[0].summary, "林凡突破炼气四层，得知父亲下落。");
  assert.equal(r.applied, 2);
  assert.equal(r.proposed, 1);
  const w = stateAt(n.characters, n.memory.events, 6);
  assert.equal(w["c1"].inventory["灵石"], 300);
  assert.equal(w["c1"].inventory["玉佩"], 1);
  assert.equal(w["c1"].attrs["境界"], "炼气三层", "提案未确认前不生效");
  const item = n.inbox[0];
  assert.equal(item.kind, "state_proposal");
  assert.equal(item.blocking, true);
  assert.equal(item.chapter, 5);
  assert.equal(n.memory.events.find((e) => e.id === item.refId)!.status, "proposed");
});

test("applyDigest：关闭人工确认时关键变化直接生效", () => {
  const d = parseDigest({ events: [{ character: "林凡", kind: "attr", key: "境界", value: "炼气四层", evidence: "突破到了炼气四层" }] });
  const r = applyDigest(novel({ settings: { ...DEFAULT_SETTINGS, confirmCritical: false } }), 5, d, TEXT, 1000);
  assert.equal(r.proposed, 0);
  assert.equal(stateAt(r.novel.characters, r.novel.memory.events, 6)["c1"].attrs["境界"], "炼气四层");
  assert.equal(r.novel.inbox.length, 0);
});

test("applyDigest：丢弃证据不符、人物未知、与当前状态相同的事件", () => {
  const d = parseDigest({
    events: [
      { character: "林凡", kind: "attr", key: "伤势", value: "重伤", evidence: "林凡被一剑刺穿胸口" },
      { character: "赵无极", kind: "attr", key: "所在地", value: "北冥", evidence: "就在北冥" },
      { character: "苏师姐", kind: "attr", key: "所在地", value: "北冥", evidence: "就在北冥" },
      { character: "林凡", kind: "attr", key: "境界", value: "炼气三层", evidence: "终于突破到了炼气四层" },
    ],
  });
  const r = applyDigest(novel(), 5, d, TEXT, 1000);
  assert.equal(r.applied, 1, "只有通过别名解析到苏晴的那条生效");
  assert.equal(r.dropped.length, 3);
  assert.equal(r.novel.memory.events[0].target, "c2");
});

test("applyDigest：新人物、新秘密、信息差和关系", () => {
  const d = parseDigest({
    newCharacters: [
      { name: "王掌柜", role: "配角", profile: "杂货铺掌柜", attrs: { 所在地: "青云镇" } },
      { name: "苏晴", role: "女主" },
    ],
    newSecrets: [{ ref: "S1", content: "林凡的父亲还活着，在北冥", knownToReader: true }],
    events: [
      { character: "林凡", kind: "knowledge", key: "S1", op: "add", evidence: "其实你父亲还活着，就在北冥" },
      { character: "林凡", kind: "relation", key: "王掌柜", value: "交易对象", evidence: "五百块灵石交给了王掌柜" },
    ],
  });
  const r = applyDigest(novel(), 5, d, TEXT, 1000);
  const n = r.novel;
  assert.equal(n.characters.length, 3, "重名人物不重复添加");
  const wang = n.characters.find((c) => c.name === "王掌柜")!;
  assert.equal(wang.source, "ai");
  assert.equal(wang.firstAppearance, 5);
  assert.equal(n.memory.secrets.length, 1);
  const w = stateAt(n.characters, n.memory.events, 6);
  assert.deepEqual(w["c1"].knows, [n.memory.secrets[0].id]);
  assert.equal(w["c1"].relations[wang.id], "交易对象");
});

test("applyDigest：伏笔埋设/推进/回收，未知 id 被丢弃", () => {
  const base = novel({
    memory: {
      ...emptyMemory(),
      hooks: [{ id: "aa11bb22", type: "mystery", content: "父亲失踪", importance: "major", status: "open", plantedIn: 1, history: [{ chapter: 1, op: "plant", note: "" }], source: "ai" }],
    },
  });
  const d = parseDigest({
    hooks: [
      { op: "advance", id: "[aa11bb22]", note: "得知父亲在北冥" },
      { op: "plant", content: "玉佩的来历", type: "foreshadow", importance: "minor" },
      { op: "resolve", id: "zzzz", note: "" },
    ],
  });
  const r = applyDigest(base, 5, d, TEXT, 1000);
  const hooks = r.novel.memory.hooks;
  assert.equal(hooks.length, 2);
  assert.equal(hooks[0].status, "progressing");
  assert.equal(hooks[1].plantedIn, 5);
  assert.equal(r.dropped.length, 1);
});

test("applyDigest：变化描述中物品数量带正负号", () => {
  const d = parseDigest({
    events: [
      { character: "林凡", kind: "inventory", key: "灵石", op: "add", value: -500, evidence: "取出五百块灵石交给了王掌柜" },
      { character: "林凡", kind: "inventory", key: "玉佩", op: "add", value: 1, evidence: "林凡收下玉佩" },
    ],
  });
  const r = applyDigest(novel(), 5, d, TEXT, 1000);
  assert.deepEqual(r.changes, ["林凡：灵石 -500", "林凡：玉佩 +1"]);
});

test("applyDigest：物品数量必须是数字，否则丢弃（防止把任意文本写进记忆）", () => {
  const d = parseDigest({
    events: [{ character: "林凡", kind: "inventory", key: "灵石", op: "set", value: "<img src=x onerror=alert(1)>", evidence: "取出五百块灵石交给了王掌柜" }],
  });
  const r = applyDigest(novel(), 5, d, TEXT, 1000);
  assert.equal(r.applied, 0);
  assert.match(r.dropped[0], /数量/);
});

test("applyDigest：伏笔历史记录标注来源为 ai", () => {
  const d = parseDigest({ hooks: [{ op: "plant", content: "新坑" }] });
  const r = applyDigest(novel(), 5, d, TEXT, 1000);
  assert.equal(r.novel.memory.hooks[0].history[0].source, "ai");
});
