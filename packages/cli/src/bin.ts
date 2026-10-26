#!/usr/bin/env node
import { formatError, run } from "./cli.js";

run(process.argv).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    const formatted = formatError(error);
    process.stderr.write(`${formatted.message}\n`);
    process.exitCode = formatted.exitCode;
  },
);
