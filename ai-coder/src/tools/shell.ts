import { spawn } from "node:child_process";
import { config } from "../config.js";
import { truncate } from "../util/path.js";
import type { Tool } from "./types.js";

const isWin = process.platform === "win32";

export const runCommand: Tool<{ command: string; timeout?: number }> = {
  name: "run_command",
  description: `在工作区目录执行 shell 命令（${isWin ? "Windows 下使用 PowerShell" : "使用 bash/sh"}），返回退出码和输出。适合运行测试、构建、git、安装依赖等。不要运行需要交互输入或永不退出的命令（如 dev server）。`,
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "要执行的命令" },
      timeout: { type: "number", description: `超时秒数，默认 ${config.commandTimeoutSec}` },
    },
    required: ["command"],
  },
  needsApproval: true,
  async preview(args) {
    return `$ ${args.command}`;
  },
  async run(args, ctx) {
    const timeoutMs = Math.min(args.timeout ?? config.commandTimeoutSec, 600) * 1000;
    const [shell, shellArgs] = isWin
      ? ["powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", args.command]]
      : [process.env.SHELL || "/bin/sh", ["-c", args.command]];

    return await new Promise<string>((resolve) => {
      const child = spawn(shell, shellArgs, {
        cwd: ctx.workspace,
        env: { ...process.env, CI: "1", FORCE_COLOR: "0", NO_COLOR: "1" },
        windowsHide: true,
      });
      let output = "";
      const onData = (d: Buffer) => {
        output += d.toString("utf8");
        if (output.length > 2_000_000) output = output.slice(-1_000_000);
      };
      child.stdout.on("data", onData);
      child.stderr.on("data", onData);
      let timedOut = false;
      const kill = () => {
        if (isWin && child.pid) spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
        else child.kill("SIGKILL");
      };
      const timer = setTimeout(() => {
        timedOut = true;
        kill();
      }, timeoutMs);
      const onAbort = () => kill();
      ctx.signal.addEventListener("abort", onAbort);
      const finish = (code: number | null, extra = "") => {
        clearTimeout(timer);
        ctx.signal.removeEventListener("abort", onAbort);
        const head = timedOut ? `[超时 ${timeoutMs / 1000}s，已终止]` : ctx.signal.aborted ? "[已被用户中止]" : `[退出码 ${code}]`;
        // eslint-disable-next-line no-control-regex
        const clean = output.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
        resolve(`${head}${extra}\n${truncate(clean.trim() || "(无输出)", config.maxToolOutput)}`);
      };
      child.on("error", (e) => finish(null, ` 启动失败：${e.message}`));
      child.on("close", (code) => finish(code));
    });
  },
};
