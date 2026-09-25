// 收集 test/ 下所有 *.test.ts 交给 node:test 运行（Node 20 的 --test 不支持 glob）
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

function collect(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return collect(p);
    return name.endsWith(".test.ts") ? [p] : [];
  });
}

const filter = process.argv[2];
const files = collect("test").filter((f) => !filter || f.includes(filter));
if (!files.length) {
  console.error("没有找到测试文件");
  process.exit(1);
}
const r = spawnSync(process.execPath, ["--import", "tsx", "--test", ...files], { stdio: "inherit" });
process.exit(r.status ?? 1);
