import { test } from "node:test";
import assert from "node:assert/strict";
import { extractJSON } from "../src/llm.js";

test("extractJSON 支持代码块和前后多余文字", () => {
  assert.deepEqual(extractJSON('好的：\n```json\n{"a":1}\n```\n以上'), { a: 1 });
  assert.deepEqual(extractJSON('结果是 [1,2] 。'), [1, 2]);
});

test("extractJSON 修复尾逗号和中文引号", () => {
  assert.deepEqual(extractJSON('{"a":[1,2,],}'), { a: [1, 2] });
  assert.deepEqual(extractJSON("{“a”:“b”}"), { a: "b" });
});

test("extractJSON 无 JSON 时报错", () => {
  assert.throws(() => extractJSON("没有内容"), /没有 JSON/);
});
