#!/usr/bin/env node

import { LifecycleError } from "./lifecycle-core.mjs";
import { finalizeProjectFileAttempt } from "./project-file-finalizer.mjs";

function parseArguments(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    if (!key.startsWith("--")) continue;
    const value = values[index + 1];
    if (value === undefined || value.startsWith("--")) {
      result[key.slice(2)] = true;
    } else {
      result[key.slice(2)] = value;
      index += 1;
    }
  }
  return result;
}

const options = parseArguments(process.argv.slice(2));

try {
  for (const required of ["project-root", "request-id"]) {
    if (!options[required]) {
      throw new LifecycleError(
        "ARGUMENT_REQUIRED",
        `--${required} is required.`,
        undefined,
        400,
      );
    }
  }
  const result = await finalizeProjectFileAttempt({
    projectRoot: options["project-root"],
    requestId: options["request-id"],
    attemptId: options["attempt-id"] ?? "attempt_001",
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      ok: false,
      error: {
        code: error?.code ?? "FINALIZER_FAILED",
        message: error instanceof Error ? error.message : "Finalizer failed.",
        ...(error?.details === undefined ? {} : { details: error.details }),
      },
    })}\n`,
  );
  process.exitCode = 1;
}
