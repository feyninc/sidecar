/** Regression tests for deterministic plugin download archives. */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { writeZipArchive } from "../src/zip.js";

describe("writeZipArchive", () => {
  it("writes repeatable archives with readable nested files", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "sidecar-zip-"));
    const sourceDir = path.join(rootDir, "source");

    try {
      await mkdir(path.join(sourceDir, "nested"), { recursive: true });
      await writeFile(path.join(sourceDir, "z.txt"), "last\n");
      await writeFile(path.join(sourceDir, "a.txt"), "first\n");
      await writeFile(path.join(sourceDir, "nested", "b.txt"), "nested\n");

      const firstPath = path.join(rootDir, "first.zip");
      const secondPath = path.join(rootDir, "second.zip");
      await writeZipArchive(sourceDir, firstPath);
      await writeZipArchive(sourceDir, secondPath);

      const first = await readFile(firstPath);
      const second = await readFile(secondPath);
      expect(first).toEqual(second);
      expect(readLocalFiles(first)).toEqual(new Map([
        ["a.txt", "first\n"],
        ["nested/b.txt", "nested\n"],
        ["z.txt", "last\n"],
      ]));
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});

/** Reads the local-file records used by every ZIP reader before the central directory. */
function readLocalFiles(archive: Buffer): Map<string, string> {
  const files = new Map<string, string>();
  let offset = 0;

  while (archive.readUInt32LE(offset) === 0x04034b50) {
    const compression = archive.readUInt16LE(offset + 8);
    const compressedSize = archive.readUInt32LE(offset + 18);
    const nameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const contentsStart = nameStart + nameLength + extraLength;
    const name = archive.subarray(nameStart, nameStart + nameLength).toString("utf8");
    const compressed = archive.subarray(contentsStart, contentsStart + compressedSize);

    expect(compression).toBe(8);
    files.set(name, inflateRawSync(compressed).toString("utf8"));
    offset = contentsStart + compressedSize;
  }

  expect(archive.readUInt32LE(offset)).toBe(0x02014b50);
  return files;
}
