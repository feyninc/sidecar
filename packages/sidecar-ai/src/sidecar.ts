#!/usr/bin/env node
/**
 * `sidecar` binary shim installed by the batteries-included `sidecar-ai`
 * package.
 */
import { exit } from "node:process";
import { main } from "@sidecar-ai/cli";

main(process.argv).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  exit(1);
});
