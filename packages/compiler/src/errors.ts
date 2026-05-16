import type { SourceFile } from "ts-morph";

export class CompilerError extends Error {
  constructor(sourceFile: SourceFile, message: string) {
    super(`${sourceFile.getFilePath()}: ${message}`);
    this.name = "CompilerError";
  }
}
