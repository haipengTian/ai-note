import fs from "node:fs/promises";
import path from "node:path";
import { resolveInWorkspace, displayPath, IGNORED_DIRS } from "../util/path.js";
import { unifiedDiff } from "../util/diff.js";
import type { Tool, ToolContext } from "./types.js";

async function exists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readText(abs: string): Promise<string> {
  const buf = await fs.readFile(abs);
  if (buf.subarray(0, 8000).includes(0)) throw new Error("这是一个二进制文件，无法以文本读取");
  return buf.toString("utf8");
}

/** 修改已有文件前必须先读过，且读取后文件未被外部改动 */
async function assertFresh(abs: string, ctx: ToolContext, rel: string) {
  const readAt = ctx.readFiles.get(abs);
  if (readAt === undefined) throw new Error(`修改前必须先用 read_file 读取 ${rel}`);
  const st = await fs.stat(abs);
  if (st.mtimeMs > readAt + 1) throw new Error(`${rel} 在上次读取后被修改过，请重新 read_file 后再编辑`);
}

async function markRead(abs: string, ctx: ToolContext) {
  const st = await fs.stat(abs);
  ctx.readFiles.set(abs, st.mtimeMs);
}

// ---------------------------------------------------------------- list_dir
export const listDir: Tool<{ path?: string; depth?: number }> = {
  name: "list_dir",
  description: "列出目录结构（树形）。会自动忽略 node_modules、.git 等目录。",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "相对工作区的目录路径，默认为根目录" },
      depth: { type: "number", description: "递归深度，默认 2，最大 5" },
    },
  },
  needsApproval: false,
  async run(args, ctx) {
    const root = resolveInWorkspace(ctx.workspace, args.path);
    const maxDepth = Math.min(Math.max(args.depth ?? 2, 1), 5);
    const out: string[] = [displayPath(ctx.workspace, root) + "/"];
    let count = 0;
    async function walk(dir: string, depth: number, prefix: string) {
      if (count > 500) return;
      let entries = await fs.readdir(dir, { withFileTypes: true });
      entries = entries
        .filter((e) => !(e.isDirectory() && IGNORED_DIRS.has(e.name)))
        .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
      for (const e of entries) {
        if (++count > 500) {
          out.push(prefix + "...(条目过多，已省略)");
          return;
        }
        out.push(prefix + e.name + (e.isDirectory() ? "/" : ""));
        if (e.isDirectory() && depth < maxDepth) await walk(path.join(dir, e.name), depth + 1, prefix + "  ");
      }
    }
    await walk(root, 1, "  ");
    return out.join("\n");
  },
};

// ---------------------------------------------------------------- read_file
export const readFile: Tool<{ path: string; offset?: number; limit?: number }> = {
  name: "read_file",
  description:
    "读取文本文件，返回带行号的内容（格式：行号→内容）。大文件可用 offset/limit 分段读取。修改文件前必须先读取。",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "文件路径（相对工作区）" },
      offset: { type: "number", description: "起始行号（从 1 开始），默认 1" },
      limit: { type: "number", description: "读取行数，默认 2000" },
    },
    required: ["path"],
  },
  needsApproval: false,
  async run(args, ctx) {
    const abs = resolveInWorkspace(ctx.workspace, args.path);
    const text = await readText(abs);
    await markRead(abs, ctx);
    const lines = text.split("\n");
    const start = Math.max(1, args.offset ?? 1);
    const limit = Math.max(1, args.limit ?? 2000);
    const slice = lines.slice(start - 1, start - 1 + limit);
    if (slice.length === 0) return `(文件共 ${lines.length} 行，offset 超出范围)`;
    const body = slice
      .map((l, i) => `${String(start + i).padStart(5)}→${l.length > 2000 ? l.slice(0, 2000) + "…" : l}`)
      .join("\n");
    const end = start + slice.length - 1;
    const more = end < lines.length ? `\n\n(共 ${lines.length} 行，已显示 ${start}-${end} 行)` : "";
    return body + more;
  },
};

// ---------------------------------------------------------------- write_file
export const writeFile: Tool<{ path: string; content: string }> = {
  name: "write_file",
  description: "创建新文件或整体覆盖文件。修改已有文件时优先使用 edit_file；覆盖已有文件前必须先读取。",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "文件路径（相对工作区）" },
      content: { type: "string", description: "完整文件内容" },
    },
    required: ["path", "content"],
  },
  needsApproval: true,
  async preview(args, ctx) {
    const abs = resolveInWorkspace(ctx.workspace, args.path);
    const old = (await exists(abs)) ? await readText(abs) : "";
    return unifiedDiff(old, args.content, displayPath(ctx.workspace, abs));
  },
  async run(args, ctx) {
    const abs = resolveInWorkspace(ctx.workspace, args.path);
    const rel = displayPath(ctx.workspace, abs);
    const existed = await exists(abs);
    if (existed) await assertFresh(abs, ctx, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, args.content, "utf8");
    await markRead(abs, ctx);
    return `${existed ? "已覆盖" : "已创建"} ${rel}（${args.content.split("\n").length} 行）`;
  },
};

// ---------------------------------------------------------------- edit_file
interface EditArgs {
  path: string;
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

function applyEdit(text: string, args: EditArgs, rel: string): string {
  if (args.old_string === args.new_string) throw new Error("old_string 与 new_string 相同，没有改动");
  if (!args.old_string) throw new Error("old_string 不能为空；创建新文件请用 write_file");
  // 兼容 CRLF 文件：模型通常给出 LF
  const crlf = text.includes("\r\n");
  const norm = crlf ? text.replace(/\r\n/g, "\n") : text;
  const oldS = args.old_string.replace(/\r\n/g, "\n");
  const newS = args.new_string.replace(/\r\n/g, "\n");
  const count = norm.split(oldS).length - 1;
  if (count === 0) throw new Error(`在 ${rel} 中没有找到 old_string，请确认内容（含缩进、空格）与文件完全一致`);
  if (count > 1 && !args.replace_all)
    throw new Error(`old_string 在 ${rel} 中出现了 ${count} 次，请提供更多上下文使其唯一，或设置 replace_all=true`);
  const out = args.replace_all ? norm.split(oldS).join(newS) : norm.replace(oldS, () => newS);
  return crlf ? out.replace(/\n/g, "\r\n") : out;
}

export const editFile: Tool<EditArgs> = {
  name: "edit_file",
  description:
    "对文件做精确的字符串替换：把 old_string 替换为 new_string。old_string 必须与文件内容逐字一致（不要包含 read_file 输出里的行号前缀），且在文件中唯一，除非 replace_all=true。编辑前必须先 read_file。",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "文件路径（相对工作区）" },
      old_string: { type: "string", description: "要被替换的原文" },
      new_string: { type: "string", description: "替换后的新文本" },
      replace_all: { type: "boolean", description: "是否替换所有出现，默认 false" },
    },
    required: ["path", "old_string", "new_string"],
  },
  needsApproval: true,
  async preview(args, ctx) {
    const abs = resolveInWorkspace(ctx.workspace, args.path);
    const rel = displayPath(ctx.workspace, abs);
    const old = await readText(abs);
    return unifiedDiff(old.replace(/\r\n/g, "\n"), applyEdit(old, args, rel).replace(/\r\n/g, "\n"), rel);
  },
  async run(args, ctx) {
    const abs = resolveInWorkspace(ctx.workspace, args.path);
    const rel = displayPath(ctx.workspace, abs);
    await assertFresh(abs, ctx, rel);
    const old = await readText(abs);
    const updated = applyEdit(old, args, rel);
    await fs.writeFile(abs, updated, "utf8");
    await markRead(abs, ctx);
    return `已编辑 ${rel}\n` + unifiedDiff(old.replace(/\r\n/g, "\n"), updated.replace(/\r\n/g, "\n"), rel, 2);
  },
};
