import { createServer } from "node:http";

function collectBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  response.end(body);
}

function extractFrozenHtml(messages) {
  const user = (Array.isArray(messages) ? messages : [])
    .find((message) => message?.role === "user");
  const text = String(user?.content || "");
  const match = text.match(/<!DOCTYPE html[\s\S]*<\/html>/iu)
    || text.match(/<html[\s\S]*<\/html>/iu);
  return match ? match[0] : "";
}

function appliedReasoning(payload) {
  if (payload?.thinking?.type === "disabled") return "none";
  const effort = String(payload?.reasoning_effort || "").trim();
  if (["low", "high", "max"].includes(effort)) return effort;
  return "auto";
}

export function mutateOpenAiCompatibleCandidateHtml(html, reasoning) {
  const source = html || [
    "<!DOCTYPE html><html><head><title>e2e</title></head>",
    "<body><h1>真实 </h1></body></html>",
  ].join("");
  const applied = String(reasoning || "auto").replace(/[^a-z]/gu, "").slice(0, 16) || "auto";
  return source
    .replace(
      /<body([^>]*)>/iu,
      `<body$1 data-pageroot-http-agent="e2e" data-pageroot-http-reasoning="${applied}">`,
    )
    .replace(
      /(<h1\b[^>]*>)\u771f\u5b9e /iu,
      "$1源页已更新：真实 ",
    );
}

export function startOpenAiCompatibleHttpAgent({
  mode = "ready",
  host = "127.0.0.1",
  rejectedApiKeys = [],
} = {}) {
  const rejected = new Set(rejectedApiKeys.map((value) => String(value)));
  return new Promise((resolve, reject) => {
    const server = createServer((request, response) => {
      void (async () => {
        const url = new URL(request.url || "/", `http://${host}`);
        if (mode === "hang") return;
        const apiKey = String(request.headers.authorization || "").replace(/^Bearer\s+/iu, "");
        if (rejected.has(apiKey)) {
          sendJson(response, 401, { error: { code: "invalid_api_key", message: "invalid token" } });
          return;
        }
        if (mode === "auth-required") {
          sendJson(response, 401, { error: { message: "invalid token" } });
          return;
        }
        if (mode === "capacity") {
          sendJson(response, 429, { error: { message: "quota exceeded" } });
          return;
        }
        if (request.method === "POST" && url.pathname.endsWith("/chat/completions")) {
          const raw = await collectBody(request);
          let payload = {};
          try {
            payload = JSON.parse(raw);
          } catch {
            payload = {};
          }
          if (mode === "invalid-html") {
            sendJson(response, 200, {
              choices: [{ message: { content: "I updated the title." } }],
            });
            return;
          }
          sendJson(response, 200, {
            choices: [{
              message: {
                content: mutateOpenAiCompatibleCandidateHtml(
                  extractFrozenHtml(payload.messages),
                  appliedReasoning(payload),
                ),
              },
            }],
          });
          return;
        }
        sendJson(response, 404, { error: { message: "not found" } });
      })().catch(() => {
        if (!response.headersSent) {
          sendJson(response, 500, { error: { message: "fixture failed" } });
        }
      });
    });
    server.on("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      resolve({
        port: address.port,
        baseUrl: `http://${host}:${address.port}/v1`,
        close() {
          return new Promise((done, fail) => {
            server.close((error) => (error ? fail(error) : done()));
          });
        },
      });
    });
  });
}
