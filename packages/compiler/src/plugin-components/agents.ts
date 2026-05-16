/** Claude agent generation from typed Sidecar agent files. */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  existsSyncSafe,
  readObjectString,
  readObjectStringArray,
  stripUndefined,
} from "../utils.js";

/** Emits `agents/*.md` from `agents/*.agent.ts` files. */
export async function emitClaudeAgents(
  rootDir: string,
  destination: string,
): Promise<void> {
  const source = path.join(rootDir, "agents");
  if (!existsSyncSafe(source)) {
    return;
  }

  const entries = await readdir(source, { withFileTypes: true });
  const agentFiles = entries.filter(
    (entry) => entry.isFile() && entry.name.endsWith(".agent.ts"),
  );
  if (!agentFiles.length) {
    return;
  }

  await mkdir(destination, { recursive: true });
  for (const entry of agentFiles) {
    const sourceText = await readFile(path.join(source, entry.name), "utf8");
    const markdown = parseClaudeAgent(
      sourceText,
      entry.name.replace(/\.agent\.ts$/, ""),
    );
    const agentName =
      readObjectString(sourceText, "name") ??
      entry.name.replace(/\.agent\.ts$/, "");
    await writeFile(path.join(destination, `${agentName}.md`), markdown);
  }
}

/** Parses the object-literal agent declaration into Claude markdown. */
function parseClaudeAgent(source: string, fallbackName: string): string {
  const name = readObjectString(source, "name") ?? fallbackName;
  const description =
    readObjectString(source, "description") ?? `${name} agent.`;
  const prompt = readObjectString(source, "prompt") ?? "";
  const tools = readObjectStringArray(source, "tools");
  const disallowedTools = readObjectStringArray(source, "disallowedTools");
  const model = readObjectString(source, "model");
  const color = readObjectString(source, "color");

  const frontmatter = stripUndefined({
    name,
    description,
    model,
    color,
    tools: tools?.join(", "),
    "disallowed-tools": disallowedTools?.join(", "),
  });

  return `---
${Object.entries(frontmatter)
  .map(([key, value]) => `${key}: ${value}`)
  .join("\n")}
---

${prompt.trim()}
`;
}
