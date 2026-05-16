/** Compiler-specific errors include the source file path in their message. */
import type { SourceFile } from "ts-morph";

/** Error thrown when a reserved file violates Sidecar's authoring contract. */
export class CompilerError extends Error {
  constructor(sourceFile: SourceFile, message: string) {
    super(`${sourceFile.getFilePath()}: ${message}`);
    this.name = "CompilerError";
  }
}
