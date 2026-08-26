import readline from "node:readline";

const mode = process.env.FAKE_CODEX_APP_SERVER_MODE || "ready";
const secretCanary = "SYNTHETIC_CODEX_SECRET_CANARY";

if (mode === "early-exit") process.exit(17);

const input = readline.createInterface({ input: process.stdin });
input.on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (mode === "hang") return;
  if (mode === "invalid-utf8") {
    process.stdout.write(Buffer.from([0xc3, 0x28, 0x0a]));
    return;
  }
  if (mode === "oversized") {
    process.stdout.write("x".repeat(1024 * 1024 + 1));
    return;
  }
  if (mode === "malformed") {
    process.stdout.write("not-json\n");
    return;
  }
  if (message.method === "initialize") {
    process.stdout.write(`${JSON.stringify({
      id: message.id,
      result: { userAgent: "synthetic-codex/0.149.1" },
    })}\n`);
    return;
  }
  if (message.method === "account/read") {
    process.stderr.write(`${secretCanary}\n`);
    process.stdout.write(`${JSON.stringify({
      id: message.id,
      result: mode === "auth-required"
        ? { account: null, requiresOpenaiAuth: true }
        : { account: { type: "chatgpt" }, requiresOpenaiAuth: true },
    })}\n`);
    return;
  }
  if (message.method === "model/list") {
    process.stdout.write(`${JSON.stringify({
      id: message.id,
      result: {
        data: mode === "empty-catalog" ? [] : [
          {
            id: "gpt-synthetic",
            displayName: "GPT Synthetic",
            hidden: false,
            supportedReasoningEfforts: [
              { reasoningEffort: "medium", description: "Balanced" },
              { reasoningEffort: "high", description: "Deep" },
            ],
            defaultReasoningEffort: "medium",
            isDefault: true,
          },
          {
            id: "hidden-model",
            displayName: "Hidden",
            hidden: true,
            supportedReasoningEfforts: [],
            defaultReasoningEffort: "medium",
            isDefault: false,
          },
        ],
        nextCursor: null,
      },
    })}\n`);
  }
});
