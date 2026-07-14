/** Small deterministic ZIP writer for generated plugin downloads. */
import { deflateRawSync } from "node:zlib";
import { lstat, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type ZipEntry = {
  name: string;
  contents: Buffer;
  compressed: Buffer;
  crc: number;
  offset: number;
};

const UTF8_FLAG = 0x0800;
const DEFLATE = 8;
const DOS_DATE = 0x0021;

/** Archives a directory without shelling out to a platform-specific zip command. */
export async function writeZipArchive(
  sourceDir: string,
  archivePath: string,
): Promise<void> {
  const files = await collectFiles(sourceDir);
  let offset = 0;
  const entries: ZipEntry[] = [];
  const localParts: Buffer[] = [];

  for (const file of files) {
    const contents = await readFile(path.join(sourceDir, file));
    const compressed = deflateRawSync(contents, { level: 9 });
    const name = file.split(path.sep).join("/");
    const encodedName = Buffer.from(name, "utf8");
    const crc = crc32(contents);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(UTF8_FLAG, 6);
    header.writeUInt16LE(DEFLATE, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(DOS_DATE, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(contents.length, 22);
    header.writeUInt16LE(encodedName.length, 26);
    header.writeUInt16LE(0, 28);
    localParts.push(header, encodedName, compressed);
    entries.push({ name, contents, compressed, crc, offset });
    offset += header.length + encodedName.length + compressed.length;
  }

  const centralOffset = offset;
  const centralParts: Buffer[] = [];
  for (const entry of entries) {
    const encodedName = Buffer.from(entry.name, "utf8");
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(0x0314, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(UTF8_FLAG, 8);
    header.writeUInt16LE(DEFLATE, 10);
    header.writeUInt16LE(0, 12);
    header.writeUInt16LE(DOS_DATE, 14);
    header.writeUInt32LE(entry.crc, 16);
    header.writeUInt32LE(entry.compressed.length, 20);
    header.writeUInt32LE(entry.contents.length, 24);
    header.writeUInt16LE(encodedName.length, 28);
    header.writeUInt16LE(0, 30);
    header.writeUInt16LE(0, 32);
    header.writeUInt16LE(0, 34);
    header.writeUInt16LE(0, 36);
    header.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    header.writeUInt32LE(entry.offset, 42);
    centralParts.push(header, encodedName);
    offset += header.length + encodedName.length;
  }

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(offset - centralOffset, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);

  await writeFile(archivePath, Buffer.concat([...localParts, ...centralParts, end]));
}

async function collectFiles(rootDir: string, relativeDir = ""): Promise<string[]> {
  const entries = await readdir(path.join(rootDir, relativeDir), {
    withFileTypes: true,
  });
  const files: string[] = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const relativePath = path.join(relativeDir, entry.name);
    const stat = await lstat(path.join(rootDir, relativePath));
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      files.push(...(await collectFiles(rootDir, relativePath)));
    } else if (stat.isFile()) {
      files.push(relativePath);
    }
  }
  return files;
}

function crc32(buffer: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
