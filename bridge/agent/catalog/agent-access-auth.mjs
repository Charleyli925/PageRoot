import { agentProviderError } from "../providers/agent-provider-contract.mjs";
import {
  accessOperationFromLoginSnapshot,
} from "../../../shared/agent-access-operation.mjs";
import { publicAgentAuthSource } from "../../../shared/agent-auth-source.mjs";
import { publicAgentLoginUrl } from "../../../shared/agent-login-url.mjs";

export const LOGIN_STATES = Object.freeze([
  "idle",
  "waiting",
  "cancelling",
  "succeeded",
  "failed",
  "cancelled",
]);
const LOGIN_TERMINAL_STATES = Object.freeze(["succeeded", "failed", "cancelled"]);
const DEFAULT_LOGIN_TIMEOUT_MS = 15 * 60 * 1000;

function fail(code, message, options) {
  throw agentProviderError(code, message, options);
}

function publicStartedAt(startedAt) {
  const timestamp = Number(startedAt);
  return Number.isFinite(timestamp) && timestamp > 0
    ? new Date(timestamp).toISOString()
    : null;
}

export function createAgentAccessAuth({
  now = () => Date.now(),
  timeoutMs = DEFAULT_LOGIN_TIMEOUT_MS,
} = {}) {
  const jobs = new Map();
  const generations = new Map();

  function nextGeneration(providerId) {
    const generation = (generations.get(providerId) || 0) + 1;
    generations.set(providerId, generation);
    return generation;
  }

  function jobSnapshot(providerId) {
    const job = jobs.get(providerId);
    if (!job) {
      return Object.freeze({
        providerId,
        loginState: "idle",
        generation: generations.get(providerId) || 0,
        startedAt: null,
        errorCode: null,
        loginUrlPresent: false,
        ...publicAgentAuthSource(),
      });
    }
    return Object.freeze({
      providerId,
      loginState: LOGIN_STATES.includes(job.loginState) ? job.loginState : "failed",
      generation: job.generation,
      startedAt: job.loginState === "waiting" || job.loginState === "cancelling"
        ? publicStartedAt(job.startedAt)
        : null,
      errorCode: job.errorCode,
      loginUrlPresent: Boolean(job.loginUrl),
      ...publicAgentAuthSource(job),
    });
  }

  function currentJob(providerId) {
    return jobs.get(providerId) || null;
  }

  function terminalStateForCode(code) {
    if (code === "AGENT_LOGIN_EXPIRED") return "failed";
    if (code === "AGENT_LOGIN_CANCELLED" || code === "AGENT_LOGIN_STALE") return "cancelled";
    return "failed";
  }

  async function abortJob(job, code = "AGENT_LOGIN_CANCELLED") {
    if (!job || job.loginState === "idle" || LOGIN_TERMINAL_STATES.includes(job.loginState)) {
      return;
    }
    job.loginState = "cancelling";
    job.controller.abort();
    try {
      await job.promise;
    } catch {
      // Cancellation is the requested outcome.
    }
    if (job.errorCode !== "AGENT_LOGIN_STALE") job.errorCode = code;
    job.loginState = terminalStateForCode(job.errorCode || code);
    job.loginUrl = null;
    job.startedAt = null;
  }

  return {
    snapshot(providerId) {
      return jobSnapshot(providerId);
    },
    accessOperation(providerId) {
      return accessOperationFromLoginSnapshot(jobSnapshot(providerId));
    },
    loginUrl(providerId) {
      const job = currentJob(providerId);
      return publicAgentLoginUrl(job?.loginUrl, { providerId });
    },
    async login(providerId, runner) {
      if (typeof runner !== "function") {
        fail("AGENT_LOGIN_UNSUPPORTED", "This Agent cannot start an official login.", { status: 409 });
      }
      const previous = currentJob(providerId);
      if (previous) await abortJob(previous, "AGENT_LOGIN_STALE");
      const generation = nextGeneration(providerId);
      const controller = new AbortController();
      const job = {
        generation,
        controller,
        loginState: "waiting",
        startedAt: now(),
        loginUrl: null,
        authSource: null,
        authScope: null,
        errorCode: null,
        promise: null,
      };
      jobs.set(providerId, job);
      job.promise = Promise.resolve().then(async () => {
        const timeout = setTimeout(() => {
          if (jobs.get(providerId)?.generation !== generation) return;
          controller.abort();
        }, timeoutMs);
        try {
          const result = await runner({
            signal: controller.signal,
            generation,
            timeoutMs,
            onLoginUrl(url) {
              if (jobs.get(providerId)?.generation !== generation) return;
              const allowed = publicAgentLoginUrl(url, { providerId });
              if (allowed) job.loginUrl = allowed;
            },
          });
          if (jobs.get(providerId)?.generation !== generation) {
            fail("AGENT_LOGIN_STALE", "A newer login replaced this attempt.", { status: 409 });
          }
          if (controller.signal.aborted) {
            fail(
              timeoutMs && (now() - job.startedAt) >= timeoutMs
                ? "AGENT_LOGIN_EXPIRED"
                : "AGENT_LOGIN_CANCELLED",
              timeoutMs && (now() - job.startedAt) >= timeoutMs
                ? "登录等待已超时。"
                : "登录已取消。",
              { status: timeoutMs && (now() - job.startedAt) >= timeoutMs ? 408 : 409 },
            );
          }
          job.loginState = "succeeded";
          job.loginUrl = null;
          job.startedAt = null;
          job.errorCode = null;
          job.authSource = result?.authSource || null;
          job.authScope = result?.authScope || null;
          return jobSnapshot(providerId);
        } catch (cause) {
          if (jobs.get(providerId)?.generation !== generation) {
            fail("AGENT_LOGIN_STALE", "A newer login replaced this attempt.", { status: 409 });
          }
          const cancelled = cause?.code === "AGENT_LOGIN_CANCELLED" || controller.signal.aborted;
          const expired = cause?.code === "AGENT_LOGIN_EXPIRED";
          job.loginUrl = null;
          job.startedAt = null;
          job.errorCode = expired
            ? "AGENT_LOGIN_EXPIRED"
            : cancelled
              ? "AGENT_LOGIN_CANCELLED"
              : String(cause?.code || "AGENT_LOGIN_FAILED");
          job.loginState = expired ? "failed" : cancelled ? "cancelled" : "failed";
          throw cause;
        } finally {
          clearTimeout(timeout);
        }
      });
      void job.promise.catch(() => {});
      return jobSnapshot(providerId);
    },
    async wait(providerId) {
      const job = currentJob(providerId);
      if (!job?.promise) return jobSnapshot(providerId);
      return job.promise;
    },
    async cancel(providerId) {
      const job = currentJob(providerId);
      if (!job || job.loginState === "idle" || LOGIN_TERMINAL_STATES.includes(job.loginState)) {
        return jobSnapshot(providerId);
      }
      await abortJob(job);
      return jobSnapshot(providerId);
    },
    async drain({ timeoutMs = 12_000 } = {}) {
      const pending = [...jobs.values()]
        .filter((job) => job.loginState === "waiting" || job.loginState === "cancelling")
        .map((job) => abortJob(job, "AGENT_LOGIN_CANCELLED"));
      if (pending.length === 0) {
        return [...jobs.values()].every((job) => (
          job.loginState !== "waiting" && job.loginState !== "cancelling"
        ));
      }
      const timeout = new Promise((_, reject) => {
        const timer = setTimeout(() => {
          reject(agentProviderError(
            "AGENT_LOGIN_DRAIN_UNCONFIRMED",
            "无法确认官方登录已停止。",
            { status: 503 },
          ));
        }, timeoutMs);
        timer.unref?.();
      });
      await Promise.race([Promise.allSettled(pending), timeout]);
      return [...jobs.values()].every((job) => (
        job.loginState !== "waiting" && job.loginState !== "cancelling"
      ));
    },
  };
}
