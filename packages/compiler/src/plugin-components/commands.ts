/** Claude slash-command generation from static markdown or typed command files. */
import { cp, lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  existsSyncSafe,
  readObjectString,
  readObjectStringArray,
  safeFileStem,
  stripUndefined,
  yamlScalar,
} from "../utils.js";

/** Copies markdown commands and emits `command.ts` declarations as markdown. */
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
      if (await safeCommandCopyFilter(sourcePath)) {
        await cp(sourcePath, path.join(destination, safeFileStem(entry.name.replace(/\.md$/, "")) + ".md"));
      }
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
      await writeFile(path.join(destination, `${safeFileStem(commandName)}.md`), markdown);
      continue;
    }

    await cp(sourcePath, path.join(destination, entry.name), {
      recursive: true,
      filter: safeCommandCopyFilter,
    });
  }
}

/** Avoids copying symlinks and common secret files into generated commands. */
async function safeCommandCopyFilter(sourcePath: string): Promise<boolean> {
  const basename = path.basename(sourcePath);
  if (basename === ".env" || basename.startsWith(".env.") || basename === "node_modules" || basename === ".git") {
    return false;
  }
  const stat = await lstat(sourcePath);
  return !stat.isSymbolicLink();
}

/** Parses a typed command declaration into Claude slash-command markdown. */
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
  .map(([key, value]) => `${key}: ${yamlScalar(value)}`)
  .join("\n")}
---

`
    : "";

  return `${header}${prompt.trim() || `# ${name}`}\n`;
}
