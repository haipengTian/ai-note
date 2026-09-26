import fs from "node:fs";
import path from "node:path";

/** 启动时命令行/系统传入的环境变量（在读取 .env 之前拍下），优先级高于 .env */
export const shellEnv: Record<string, string | undefined> = { ...process.env };

// 读取 .env（Node >= 20.12 内置 process.loadEnvFile，无需 dotenv）
export const envFile = path.resolve(process.cwd(), ".env");
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

/** 运行配置。模型相关配置见 models.ts / models-store.ts（支持 models.json 和网页设置） */
export const config = {
  port: num("PORT", 3000),
  host: process.env.HOST || "127.0.0.1",
  dataDir: path.resolve(process.env.DATA_DIR || "./data"),
  /** 模型配置文件；不存在时按 .env 里的 OPENAI_BASE_URL / MODEL 等推导 */
  modelsFile: path.resolve(process.env.MODELS_FILE || "models.json"),
  /** 写作/审校时注入上下文的字符预算（中文约 1 字 ≈ 1 token） */
  contextBudget: num("CONTEXT_BUDGET", 60_000),
};
