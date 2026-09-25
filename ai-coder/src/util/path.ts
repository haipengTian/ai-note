import path from "node:path";

/** 把模型给出的路径解析到工作区内，禁止越界访问 */
export function resolveInWorkspace(workspace: string, p: string | undefined): string {
  const target = path.resolve(workspace, p && p.trim() ? p : ".");
  const rel = path.relative(workspace, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`路径越界：${p} 不在工作区 ${workspace} 内`);
  }
  return target;
}

/** 以正斜杠显示的相对路径 */
export function displayPath(workspace: string, abs: string): string {
  const rel = path.relative(workspace, abs);
  return (rel || ".").split(path.sep).join("/");
}

export const IGNORED_DIRS = new Set([
  ".git", "node_modules", "dist", "build", ".next", ".nuxt", "out", "target",
  "__pycache__", ".venv", "venv", ".idea", ".vscode", "coverage", ".cache", ".turbo",
]);

/** 截断过长文本，保留头尾 */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.7);
  const tail = max - head;
  return `${text.slice(0, head)}\n\n...[已截断 ${text.length - max} 个字符]...\n\n${text.slice(-tail)}`;
}
