/** Skill copying and typed skill generation for plugin outputs. */
import { existsSync } from "node:fs";
import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { existsSyncSafe, readObjectString } from "../utils.js";

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
        filter: (sourcePath) => !sourcePath.endsWith(`${path.sep}skill.ts`),
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

/** Parses a typed skill declaration into a `SKILL.md` document. */
function parseDynamicSkill(source: string, fallbackName: string): string {
  const name = readObjectString(source, "name") ?? fallbackName;
  const description =
    readObjectString(source, "description") ?? `${name} skill.`;
  const body = readObjectString(source, "body") ?? "";

  return `---
name: ${name}
description: ${description}
---

${body.trim()}
`;
}
