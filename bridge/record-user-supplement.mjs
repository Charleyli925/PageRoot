#!/usr/bin/env node

import { readFile } from "node:fs/promises";

import {
  recordUserSupplement,
} from "./user-supplement-core.mjs";

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

async function readStandardInput() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

const options = parseArguments(process.argv.slice(2));

try {
  for (const required of ["project-root", "project-id", "request-id"]) {
    if (!options[required]) {
      throw Object.assign(
        new Error(`--${required} is required.`),
        { code: "ARGUMENT_REQUIRED", status: 400 },
      );
    }
  }
  if (options["payload-file"] && options.stdin) {
    throw Object.assign(
      new Error("Use either --payload-file or standard input, not both."),
      { code: "PAYLOAD_SOURCE_CONFLICT", status: 400 },
    );
  }
  const rawPayload = options["payload-file"]
    ? await readFile(String(options["payload-file"]), "utf8")
    : await readStandardInput();
  if (!rawPayload.trim()) {
    throw Object.assign(
      new Error("A JSON supplement payload is required on standard input."),
      { code: "PAYLOAD_REQUIRED", status: 400 },
    );
  }
  let payload;
  try {
    payload = JSON.parse(rawPayload);
  } catch {
    throw Object.assign(
      new Error("The supplement payload is not valid JSON."),
      { code: "PAYLOAD_INVALID_JSON", status: 400 },
    );
  }
  const result = await recordUserSupplement({
    projectRoot: options["project-root"],
    projectId: options["project-id"],
    requestId: options["request-id"],
    attemptId: options["attempt-id"] ?? "attempt_001",
    payload,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    error: {
      code: error?.code ?? "USER_SUPPLEMENT_FAILED",
      message: error instanceof Error ? error.message : "Supplement recording failed.",
      ...(error?.details === undefined ? {} : { details: error.details }),
    },
  })}\n`);
  process.exitCode = 1;
}
