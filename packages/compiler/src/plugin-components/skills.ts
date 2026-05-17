/** Skill copying and typed skill generation for plugin outputs. */
import { existsSync } from "node:fs";
import { cp, lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { existsSyncSafe, readObjectString, yamlScalar } from "../utils.js";

/** Copies static skills or emits `skill.ts` declarations as `SKILL.md`. */
export async function copySkills(
  rootDir: string,
  destination: string,
): Promise<void> {
  const source = path.join(rootDir, "skills");
  if (!existsSyncSafe(source)) {
    return;
  }

  await mkdir(destination, { recursive: true });
  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const sourceDir = path.join(source, entry.name);
    const destinationDir = path.join(destination, entry.name);
    const staticSkill = path.join(sourceDir, "SKILL.md");
    const dynamicSkill = path.join(sourceDir, "skill.ts");

    await mkdir(destinationDir, { recursive: true });
    if (existsSync(staticSkill)) {
      await cp(sourceDir, destinationDir, {
        recursive: true,
        filter: async (sourcePath) =>
          !sourcePath.endsWith(`${path.sep}skill.ts`) &&
          await safeSkillCopyFilter(sourcePath),
      });
    } else if (existsSync(dynamicSkill)) {
      const generated = parseDynamicSkill(
        await readFile(dynamicSkill, "utf8"),
        entry.name,
      );
      await writeFile(path.join(destinationDir, "SKILL.md"), generated);
    }
  }
}

/** Avoids copying symlinks and common secret files into generated plugins. */
async function safeSkillCopyFilter(sourcePath: string): Promise<boolean> {
  const basename = path.basename(sourcePath);
  if (basename === ".env" || basename.startsWith(".env.") || basename === "node_modules" || basename === ".git") {
    return false;
  }
  const stat = await lstat(sourcePath);
  return !stat.isSymbolicLink();
}

/** Parses a typed skill declaration into a `SKILL.md` document. */
function parseDynamicSkill(source: string, fallbackName: string): string {
  const name = readObjectString(source, "name") ?? fallbackName;
  const description =
    readObjectString(source, "description") ?? `${name} skill.`;
  const body = readObjectString(source, "body") ?? "";

return `---
name: ${yamlScalar(name)}
description: ${yamlScalar(description)}
---

${body.trim()}
`;
}
