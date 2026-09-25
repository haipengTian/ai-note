import { test } from "node:test";
import assert from "node:assert/strict";
import { countWords, clip, cleanChapterText, splitParagraphs } from "../src/util/text.js";

test("countWords 只统计非空白字符", () => {
  assert.equal(countWords("你好 世界\n\n！"), 5);
  assert.equal(countWords(""), 0);
});

test("clip 超长截断并标注", () => {
  assert.equal(clip("abc", 5), "abc");
  assert.equal(clip("abcdef", 3), "abc……（略）");
});

test("cleanChapterText 去掉标题行、代码块和本章完", () => {
  assert.equal(cleanChapterText("第一章 开端\n正文内容", "开端"), "正文内容");
  assert.equal(cleanChapterText("# 第12章 风起\n\n正文", "风起"), "正文");
  assert.equal(cleanChapterText("《风起》\n正文", "风起"), "正文");
  assert.equal(cleanChapterText("```\n正文\n```", "x"), "正文");
  assert.equal(cleanChapterText("正文\n\n（本章完）", "x"), "正文");
  assert.equal(cleanChapterText("他说第一章很好看\n正文", "x"), "他说第一章很好看\n正文");
});

test("splitParagraphs 去空行和首尾空白", () => {
  assert.deepEqual(splitParagraphs("  甲 \n\n乙\n \n丙"), ["甲", "乙", "丙"]);
});
