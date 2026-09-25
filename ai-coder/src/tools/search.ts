import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { resolveInWorkspace, displayPath, IGNORED_DIRS } from "../util/path.js";
import type { Tool } from "./types.js";

/** 把 glob 转成正则：支持 **、*、?、{a,b} */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  let inBrace = false;
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        i++;
        if (glob[i + 1] === "/") {
          i++;
          re += "(?:.*/)?";
        } else re += ".*";
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else if (c === "{") {
      inBrace = true;
      re += "(?:";
    } else if (c === "}" && inBrace) {
      inBrace = false;
      re += ")";
    } else if (c === "," && inBrace) re += "|";
    else re += c.replace(/[.+^$()|[\]\\]/g, "\\$&");
  }
  return new RegExp("^" + re + "$");
}

async function* walkFiles(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!IGNORED_DIRS.has(e.name)) yield* walkFiles(p);
    } else if (e.isFile()) yield p;
  }
}

// ---------------------------------------------------------------- find_files
export const findFiles: Tool<{ pattern: string; path?: string }> = {
  name: "find_files",
  description: '按 glob 模式查找文件，例如 "**/*.ts"、"src/**/*.{js,jsx}"、"*.json"。返回相对路径列表。',
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "glob 模式" },
      path: { type: "string", description: "搜索起始目录，默认工作区根目录" },
    },
    required: ["pattern"],
  },
  needsApproval: false,
  async run(args, ctx) {
    const root = resolveInWorkspace(ctx.workspace, args.path);
    // 不含 / 的模式匹配任意层级的文件名
    const pattern = args.pattern.includes("/") ? args.pattern : "**/" + args.pattern;
    const re = globToRegExp(pattern);
    const hits: string[] = [];
    for await (const f of walkFiles(root)) {
      const rel = path.relative(root, f).split(path.sep).join("/");
      if (re.test(rel)) {
        hits.push(displayPath(ctx.workspace, f));
        if (hits.length >= 300) break;
      }
    }
    if (!hits.length) return "没有找到匹配的文件";
    return hits.join("\n") + (hits.length >= 300 ? "\n...(结果过多，只显示前 300 个)" : "");
  },
};

// ---------------------------------------------------------------- grep
interface GrepArgs {
  pattern: string;
  path?: string;
  glob?: string;
  ignore_case?: boolean;
}

let rgAvailable: boolean | undefined;
async function hasRipgrep(): Promise<boolean> {
  if (rgAvailable !== undefined) return rgAvailable;
  rgAvailable = await new Promise<boolean>((resolve) => {
    const p = spawn("rg", ["--version"], { stdio: "ignore" });
    p.on("error", () => resolve(false));
    p.on("exit", (code) => resolve(code === 0));
  });
  return rgAvailable;
}

const MAX_MATCHES = 200;

export const grep: Tool<GrepArgs> = {
  name: "grep",
  description:
    "在文件内容中按正则搜索，返回 文件:行号:内容。可用 glob 过滤文件类型（如 \"*.ts\"）。安装了 ripgrep 时会自动使用它。",
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "正则表达式" },
      path: { type: "string", description: "搜索目录或文件，默认工作区根目录" },
      glob: { type: "string", description: '文件过滤，例如 "*.py" 或 "src/**/*.ts"' },
      ignore_case: { type: "boolean", description: "忽略大小写" },
    },
    required: ["pattern"],
  },
  needsApproval: false,
  async run(args, ctx) {
    const root = resolveInWorkspace(ctx.workspace, args.path);
    if (await hasRipgrep()) {
      const rgArgs = ["-n", "--no-heading", "--color", "never", "-M", "300", "--max-count", "50"];
      if (args.ignore_case) rgArgs.push("-i");
      if (args.glob) rgArgs.push("-g", args.glob);
      rgArgs.push("-e", args.pattern, root);
      const out = await new Promise<string>((resolve, reject) => {
        const p = spawn("rg", rgArgs, { cwd: ctx.workspace, signal: ctx.signal });
        let buf = "";
        let err = "";
        p.stdout.on("data", (d) => {
          buf += d;
          if (buf.length > 200_000) p.kill();
        });
        p.stderr.on("data", (d) => (err += d));
        p.on("error", reject);
        p.on("close", (code) => (code === 2 && !buf ? reject(new Error(err.trim())) : resolve(buf)));
      });
      const lines = out
        .split("\n")
        .filter(Boolean)
        .map((l) => {
          const rel = path.relative(ctx.workspace, l.slice(0, l.indexOf(":", 2)));
          return rel.split(path.sep).join("/") + l.slice(l.indexOf(":", 2));
        });
      if (!lines.length) return "没有匹配结果";
      return lines.slice(0, MAX_MATCHES).join("\n") + (lines.length > MAX_MATCHES ? `\n...(共 ${lines.length} 条，只显示前 ${MAX_MATCHES} 条)` : "");
    }

    // JS 兜底实现
    const re = new RegExp(args.pattern, args.ignore_case ? "i" : "");
    const globRe = args.glob ? globToRegExp(args.glob.includes("/") ? args.glob : "**/" + args.glob) : null;
    const results: string[] = [];
    const st = await fs.stat(root);
    const files = st.isFile() ? [root] : walkFiles(root);
    for await (const f of files as AsyncIterable<string>) {
      const rel = displayPath(ctx.workspace, f);
      if (globRe && !globRe.test(path.relative(root, f).split(path.sep).join("/"))) continue;
      let text: string;
      try {
        const buf = await fs.readFile(f);
        if (buf.length > 2_000_000 || buf.subarray(0, 8000).includes(0)) continue;
        text = buf.toString("utf8");
      } catch {
        continue;
      }
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) {
          results.push(`${rel}:${i + 1}:${lines[i].slice(0, 300)}`);
          if (results.length >= MAX_MATCHES) return results.join("\n") + "\n...(结果过多，已截断)";
        }
      }
    }
    return results.length ? results.join("\n") : "没有匹配结果";
  },
};
