import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// config 在导入时读取 DATA_DIR，必须先设置环境变量再动态导入
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-novel-test-"));
process.env.DATA_DIR = dataDir;
const { store } = await import("../src/store/index.js");

after(() => fs.rm(dataDir, { recursive: true, force: true }));

test("create/get：新作品按 v2 分文件保存", async () => {
  const n = await store.create({ title: "新书", idea: "灵感", genre: "都市" });
  assert.equal(n.schemaVersion, 2);
  const files = await fs.readdir(path.join(dataDir, n.id));
  for (const f of ["book.json", "bible.json", "structure.json", "memory.json", "inbox.json"]) assert.ok(files.includes(f), f);
  const got = await store.get(n.id);
  assert.equal(got.title, "新书");
  assert.equal(got.genre, "都市");
  assert.deepEqual(got.memory.events, []);
});

test("update：函数返回新对象，并发更新串行执行不丢失", async () => {
  const n = await store.create({ title: "并发" });
  await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      store.update(n.id, (x) => ({ ...x, characters: [...x.characters, { id: `c${i}`, name: `人${i}`, aliases: [], role: "配角", profile: "", initial: { attrs: {}, relations: {}, knows: [], inventory: {}, alive: true }, source: "manual" as const }] })),
    ),
  );
  const got = await store.get(n.id);
  assert.equal(got.characters.length, 10);
});

test("get：读到 v0.2 的 novel.json 时自动迁移并备份", async () => {
  const id = "0123456789ab";
  const dir = path.join(dataDir, id);
  await fs.mkdir(dir, { recursive: true });
  const v1 = {
    id,
    title: "旧书",
    genre: "玄幻",
    idea: "",
    style: "",
    targetChapters: 50,
    wordsPerChapter: 2000,
    worldview: "旧世界观",
    characters: [{ id: "c1", name: "甲", role: "主角", profile: "", state: "受伤" }],
    outline: "",
    chapters: [{ index: 1, title: "一", outline: "", characters: [], status: "written", summary: "s", words: 10 }],
    memory: { storySoFar: "", summarizedUpTo: 0, foreshadows: [] },
    settings: { autoReview: true, reviewThreshold: 80 },
    createdAt: 1,
    updatedAt: 1,
  };
  await fs.writeFile(path.join(dir, "novel.json"), JSON.stringify(v1));
  const n = await store.get(id);
  assert.equal(n.schemaVersion, 2);
  assert.equal(n.worldview, "旧世界观");
  assert.equal(n.memory.events[0].value, "受伤");
  const files = await fs.readdir(dir);
  assert.ok(files.includes("novel.v1.backup.json"));
  assert.ok(!files.includes("novel.json"));
  assert.ok(files.includes("book.json"));
});

test("list：返回所有作品并跳过非作品目录", async () => {
  await fs.mkdir(path.join(dataDir, "not-a-novel"), { recursive: true });
  const list = await store.list();
  assert.ok(list.length >= 3);
  assert.ok(list.every((n) => n.schemaVersion === 2));
});

test("writeChapter：覆盖已有正文时自动存历史版本", async () => {
  const n = await store.create({ title: "版本" });
  await store.writeChapter(n.id, 1, "第一版", "整章重写");
  await store.writeChapter(n.id, 1, "第二版", "审校修订");
  assert.equal(await store.readChapter(n.id, 1), "第二版");
  const versions = await store.listVersions(n.id, 1);
  assert.equal(versions.length, 1);
  assert.equal(versions[0].reason, "审校修订");
  assert.equal(await store.readVersion(n.id, 1, versions[0].file), "第一版");
});

test("snapshot/restore：恢复人物与记忆，恢复前自动再拍一张", async () => {
  const n = await store.create({ title: "快照" });
  await store.update(n.id, (x) => ({ ...x, memory: { ...x.memory, bookSynopsis: "快照时的梗概" } }));
  await store.snapshot(n.id, "写第1章前");
  await store.update(n.id, (x) => ({ ...x, memory: { ...x.memory, bookSynopsis: "被污染" } }));
  const [snap] = await store.listSnapshots(n.id);
  const restored = await store.restoreSnapshot(n.id, snap.file);
  assert.equal(restored.memory.bookSynopsis, "快照时的梗概");
  assert.equal((await store.listSnapshots(n.id)).length, 2);
});

test("runs：每章生产留档可写可读", async () => {
  const n = await store.create({ title: "留档" });
  await store.writeRun(n.id, 3, "context-write", { chars: 100 });
  assert.deepEqual(await store.readRun(n.id, 3, "context-write"), { chars: 100 });
  assert.equal(await store.readRun(n.id, 3, "missing"), null);
  assert.deepEqual(await store.listRuns(n.id, 3), ["context-write"]);
});

test("非法 id 被拒绝", async () => {
  await assert.rejects(() => store.get("../../etc"), /非法作品 ID/);
});
