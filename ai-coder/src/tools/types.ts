export interface ToolContext {
  workspace: string;
  signal: AbortSignal;
  /** 已被读取过的文件（绝对路径 -> 读取时的 mtime），用于防止“没看就改” */
  readFiles: Map<string, number>;
}

export interface Tool<A = any> {
  name: string;
  description: string;
  /** JSON Schema */
  parameters: Record<string, unknown>;
  /** 是否需要用户确认（写文件、执行命令等） */
  needsApproval: boolean;
  /** 审批前给用户看的预览（例如 diff） */
  preview?: (args: A, ctx: ToolContext) => Promise<string>;
  run: (args: A, ctx: ToolContext) => Promise<string>;
}
