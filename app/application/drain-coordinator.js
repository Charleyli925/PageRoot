function normalizedStatus(value) {
  if (!value || value.state === "resolved") return { state: "resolved" };
  if (value.state === "blocked") {
    return {
      state: "blocked",
      reason: String(value.reason || "当前状态需要处理后才能继续。"),
    };
  }
  return {
    state: "pending",
    reason: String(value.reason || "仍有操作尚未完成。"),
  };
}

function remainingTime(deadlineAt) {
  return Math.max(0, Number(deadlineAt || 0) - Date.now());
}

async function beforeDeadline(work, deadlineAt, label) {
  const remaining = remainingTime(deadlineAt);
  if (remaining <= 0) throw new Error(`${label}超时。`);
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(work),
      new Promise((_resolve, reject) => {
        timer = globalThis.setTimeout(
          () => reject(new Error(`${label}超时。`)),
          remaining,
        );
      }),
    ]);
  } finally {
    if (timer) globalThis.clearTimeout(timer);
  }
}

export class DrainCoordinator {
  #obligations = new Map();

  replace(name, obligation) {
    this.#obligations.set(name, Object.freeze({ ...obligation, name }));
  }

  remove(name) {
    this.#obligations.delete(name);
  }

  inspect(boundary) {
    return [...this.#obligations.values()].map((obligation) => ({
      name: obligation.name,
      label: obligation.label || obligation.name,
      alwaysDrain: obligation.alwaysDrain === true,
      ...normalizedStatus(obligation.inspect?.(boundary)),
    }));
  }

  hasPending(boundary) {
    return this.inspect(boundary).some(
      (status) => status.state !== "resolved",
    );
  }

  async drain(boundary, { deadlineAt }) {
    for (const obligation of this.#obligations.values()) {
      let status = normalizedStatus(obligation.inspect?.(boundary));
      if (status.state === "blocked") {
        return {
          ok: false,
          obligation: obligation.name,
          reason: status.reason,
        };
      }
      if (status.state === "resolved" && obligation.alwaysDrain !== true) {
        continue;
      }
      if (typeof obligation.drain !== "function") {
        return {
          ok: false,
          obligation: obligation.name,
          reason: status.reason || `${obligation.label || obligation.name}尚未完成。`,
        };
      }
      const label = obligation.label || obligation.name;
      try {
        const drained = await beforeDeadline(
          () => obligation.drain({ boundary, deadlineAt }),
          deadlineAt,
          label,
        );
        if (drained === false) {
          return {
            ok: false,
            obligation: obligation.name,
            reason: `${label}没有完成。`,
          };
        }
      } catch (cause) {
        return {
          ok: false,
          obligation: obligation.name,
          reason: cause instanceof Error ? cause.message : `${label}没有完成。`,
        };
      }
      status = normalizedStatus(obligation.inspect?.(boundary));
      if (status.state !== "resolved") {
        return {
          ok: false,
          obligation: obligation.name,
          reason: status.reason || `${label}仍未完成。`,
        };
      }
    }
    return { ok: true };
  }
}
