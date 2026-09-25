import fs from "node:fs";
import path from "node:path";

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
  modelFast: process.env.MODEL_FAST || process.env.MODEL || "gpt-4.1",
  /** 审校用模型，默认与写作模型相同（审稿需要判断力，不建议用太弱的模型） */
  modelReview: process.env.MODEL_REVIEW || process.env.MODEL || "gpt-4.1",
  /** 章后记忆抽取用模型：决定长篇一致性，默认与写作模型相同 */
  modelMemory: process.env.MODEL_MEMORY || process.env.MODEL || "gpt-4.1",
  temperature: Number(process.env.TEMPERATURE ?? 0.85),
  maxTokens: num("MAX_TOKENS", 8192),
  port: num("PORT", 3000),
  host: process.env.HOST || "127.0.0.1",
  dataDir: path.resolve(process.env.DATA_DIR || "./data"),
  /** 写作/审校时注入上下文的字符预算（中文约 1 字 ≈ 1 token） */
  contextBudget: num("CONTEXT_BUDGET", 60_000),
};
