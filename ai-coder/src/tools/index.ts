import type { ToolSchema } from "../llm.js";
import type { Tool } from "./types.js";
import { listDir, readFile, writeFile, editFile } from "./fs.js";
import { findFiles, grep } from "./search.js";
import { runCommand } from "./shell.js";

export const tools: Tool[] = [listDir, readFile, findFiles, grep, editFile, writeFile, runCommand];

export const toolMap = new Map(tools.map((t) => [t.name, t]));

export function toolSchemas(): ToolSchema[] {
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

export type { Tool, ToolContext } from "./types.js";
