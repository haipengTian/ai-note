import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";

/** 项目规则文件（按顺序查找，全部拼接） */
const RULE_FILES = ["AGENTS.md", "CLAUDE.md", ".cursorrules", ".ai-coder/rules.md"];

function gitInfo(cwd: string): string {
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    const status = execSync("git status --short", { cwd, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    const lines = status.split("\n").filter(Boolean);
    return `是 git 仓库，当前分支 ${branch}，未提交改动 ${lines.length} 个${lines.length ? "：\n" + lines.slice(0, 30).join("\n") : ""}`;
  } catch {
    return "不是 git 仓库";
  }
}

function topLevel(cwd: string): string {
  try {
    return fs
      .readdirSync(cwd, { withFileTypes: true })
      .filter((e) => !e.name.startsWith(".git") && e.name !== "node_modules")
      .slice(0, 60)
      .map((e) => e.name + (e.isDirectory() ? "/" : ""))
      .join("  ");
  } catch {
    return "";
  }
}

export function buildSystemPrompt(workspace: string): string {
  const rules = RULE_FILES.map((f) => path.join(workspace, f))
    .filter((f) => fs.existsSync(f))
    .map((f) => `### ${path.basename(f)}\n${fs.readFileSync(f, "utf8").slice(0, 20_000)}`)
    .join("\n\n");

  return `你是一个资深软件工程师，作为编程 Agent 在用户的项目中工作。你可以通过工具读取、搜索、修改代码并执行命令。

# 工作方式
- 先理解再动手：用 list_dir / find_files / grep / read_file 了解相关代码，再做修改。不要凭空猜测文件内容或 API。
- 修改已有文件优先用 edit_file 做最小改动；只有新建文件或大面积重写时才用 write_file。编辑前必须先 read_file。
- 遵循项目已有的代码风格、框架和依赖；不要随意引入新依赖。
- 改完后尽量验证：运行项目已有的测试、类型检查、lint 或构建命令，并根据报错修复。
- 可以在一次回复里并行发起多个互不依赖的只读工具调用，以节省轮数。
- 用户拒绝某个操作时，不要重复尝试同一个操作，询问用户或换一种方式。
- 不要执行破坏性命令（如 rm -rf、git reset --hard、强推）除非用户明确要求。
- 任务完成后，用简短的几句话总结做了什么、改了哪些文件、是否验证通过。不要大段重复代码。
- 用用户使用的语言回复（用户说中文就用中文）。回复使用 Markdown。

# 环境
- 工作区（所有相对路径基于此）：${workspace}
- 操作系统：${os.type()} ${os.release()} (${process.platform})
- 当前日期：${new Date().toISOString().slice(0, 10)}
- Git：${gitInfo(workspace)}
- 根目录内容：${topLevel(workspace)}
${rules ? `\n# 项目规则（来自项目中的规则文件，必须遵守）\n${rules}\n` : ""}`;
}
