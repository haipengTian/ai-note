import fs from "node:fs";
import path from "node:path";

// 读取 .env（Node >= 20.12 内置 process.loadEnvFile，无需 dotenv）
const envFile = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envFile)) {
  try {
    process.loadEnvFile(envFile);
  } catch (e) {
    console.warn("[config] 读取 .env 失败:", (e as Error).message);
  }
}

function num(name: string, def: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : def;
}

export const config = {
  baseURL: (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, ""),
  apiKey: process.env.OPENAI_API_KEY || "",
  model: process.env.MODEL || "gpt-4.1",
  workspace: path.resolve(process.env.WORKSPACE || process.cwd()),
  port: num("PORT", 3000),
  host: process.env.HOST || "127.0.0.1",
  maxSteps: num("MAX_STEPS", 50),
  commandTimeoutSec: num("COMMAND_TIMEOUT", 120),
  /** 单个工具结果回传给模型的最大字符数 */
  maxToolOutput: num("MAX_TOOL_OUTPUT", 30_000),
  /** 历史消息总字符数超过这个值时，裁掉最早的对话轮次 */
  maxHistoryChars: num("MAX_HISTORY_CHARS", 400_000),
};

export type Config = typeof config;
