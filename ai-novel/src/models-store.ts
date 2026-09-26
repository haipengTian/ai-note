/**
 * 模型配置的读写：
 * - models.json 按修改时间自动重新加载，手动改文件后下一次调用即生效
 * - 没有 models.json 时按 .env 推导（兼容旧配置）
 * - 密钥只存在 .env，每次解析时重新读取 .env，网页上设置密钥无需重启
 */
import fs from "node:fs";
import { parseEnv } from "node:util";
import { config, envFile, shellEnv } from "./config.js";
import { atomicWrite } from "./store/files.js";
import { legacyConfig, parseModelsConfig, publicView, resolveRole, upsertEnvLine, type Env, type ModelsConfig, type ResolvedModel, type Role } from "./models.js";

let cache: { mtimeMs: number; cfg: ModelsConfig } | null = null;

/** 当前生效的环境变量：.env（每次重新读取） < 命令行/系统环境变量 */
export function currentEnv(): Env {
  let fromFile: Env = {};
  try {
    fromFile = parseEnv(fs.readFileSync(envFile, "utf8"));
  } catch {
    /* 没有 .env */
  }
  return { ...fromFile, ...shellEnv };
}

export function loadModels(): { cfg: ModelsConfig; source: "file" | "legacy" } {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(config.modelsFile);
  } catch {
    cache = null;
    return { cfg: legacyConfig(currentEnv()), source: "legacy" };
  }
  if (cache?.mtimeMs !== stat.mtimeMs) {
    try {
      cache = { mtimeMs: stat.mtimeMs, cfg: parseModelsConfig(JSON.parse(fs.readFileSync(config.modelsFile, "utf8"))) };
    } catch (e) {
      throw new Error(`models.json 格式错误：${(e as Error).message}`);
    }
  }
  return { cfg: cache.cfg, source: "file" };
}

export function resolveModel(role: Role): ResolvedModel {
  return resolveRole(loadModels().cfg, role, currentEnv());
}

export function modelsView() {
  const { cfg, source } = loadModels();
  return { ...publicView(cfg, currentEnv(), source), file: config.modelsFile };
}

/** 校验后写入 models.json */
export async function saveModels(raw: unknown): Promise<ModelsConfig> {
  const cfg = parseModelsConfig(raw);
  await atomicWrite(config.modelsFile, JSON.stringify(cfg, null, 2) + "\n");
  cache = null;
  return cfg;
}

/** 把密钥写进 .env（已存在则替换）。命令行传入的同名变量优先级更高，写入后会被它覆盖 */
export async function setEnvKey(name: string, value: string) {
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new Error("环境变量名不合法");
  let text = "";
  try {
    text = fs.readFileSync(envFile, "utf8");
  } catch {
    /* 新建 .env */
  }
  await atomicWrite(envFile, upsertEnvLine(text, name, value));
}
