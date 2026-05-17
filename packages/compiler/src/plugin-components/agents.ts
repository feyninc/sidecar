/** Claude agent generation from typed Sidecar agent files. */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  existsSyncSafe,
  readObjectString,
  readObjectStringArray,
  safeFileStem,
  stripUndefined,
  yamlScalar,
} from "../utils.js";

/** Emits `agents/*.md` from reserved agent directories. */
export async function emitClaudeAgents(
  rootDir: string,
  destination: string,
): Promise<void> {
  const source = path.join(rootDir, "agents");
  if (!existsSyncSafe(source)) {
    return;
  }

  const entries = await readdir(source, { withFileTypes: true });
  const agentDirs = entries.filter(
    (entry) => entry.isDirectory() && existsSyncSafe(path.join(source, entry.name, "agent.ts")),
  );
  if (!agentDirs.length) {
    return;
  }

  await mkdir(destination, { recursive: true });
  for (const entry of agentDirs) {
    const sourceText = await readFile(path.join(source, entry.name, "agent.ts"), "utf8");
    const markdown = parseClaudeAgent(
      sourceText,
      entry.name,
    );
    const agentName =
      readObjectString(sourceText, "name") ??
      entry.name;
    await writeFile(path.join(destination, `${safeFileStem(agentName)}.md`), markdown);
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
  .map(([key, value]) => `${key}: ${yamlScalar(value)}`)
  .join("\n")}
---

${prompt.trim()}
`;
}
