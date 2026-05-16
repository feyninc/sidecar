import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  existsSyncSafe,
  readObjectString,
  readObjectStringArray,
  stripUndefined,
} from "../utils.js";

export async function copyCommands(
  rootDir: string,
  destination: string,
): Promise<void> {
  const source = path.join(rootDir, "commands");
  if (!existsSyncSafe(source)) {
    return;
  }

  await mkdir(destination, { recursive: true });
  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    if (entry.isFile() && entry.name.endsWith(".md")) {
      await cp(sourcePath, path.join(destination, entry.name));
      continue;
    }

    if (!entry.isDirectory()) {
      continue;
    }

    const dynamicCommand = path.join(sourcePath, "command.ts");
    if (existsSyncSafe(dynamicCommand)) {
      const sourceText = await readFile(dynamicCommand, "utf8");
      const markdown = parseDynamicCommand(sourceText, entry.name);
      const commandName = readObjectString(sourceText, "name") ?? entry.name;
      await writeFile(path.join(destination, `${commandName}.md`), markdown);
      continue;
    }

    await cp(sourcePath, path.join(destination, entry.name), {
      recursive: true,
    });
  }
}

function parseDynamicCommand(source: string, fallbackName: string): string {
  const name = readObjectString(source, "name") ?? fallbackName;
  const description = readObjectString(source, "description");
  const prompt = readObjectString(source, "prompt") ?? "";
  const argumentHint = readObjectString(source, "argumentHint");
  const allowedTools = readObjectStringArray(source, "allowedTools");

  const frontmatter = stripUndefined({
    description,
    "argument-hint": argumentHint,
    "allowed-tools": allowedTools?.join(", "),
  });

  const header = Object.keys(frontmatter).length
    ? `---
${Object.entries(frontmatter)
  .map(([key, value]) => `${key}: ${value}`)
  .join("\n")}
---

`
    : "";

  return `${header}${prompt.trim() || `# ${name}`}\n`;
}
