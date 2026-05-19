#!/usr/bin/env node
/**
 * `sidecar` binary shim installed by the batteries-included `sidecar-ai`
 * package.
 */
import { exit } from "node:process";

type CliModule = {
  main(argv: string[]): Promise<void>;
};

const cliPackageName = "@sidecar-ai/cli";

import(cliPackageName).then((module) => {
  return (module as CliModule).main(process.argv);
}).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  exit(1);
});
