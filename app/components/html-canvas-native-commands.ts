import type {
  NativeDeferredCommandAuthority,
  NativeDeferredCommandDiscardReason,
  NativeDeferredCommandOptions,
} from "./HtmlCanvasEditor.types";
import type {
  NativeEditLeaseStamp,
  NativeEditQueueCommandResult,
  NativeEditQueuedCommand,
} from "./native-edit-types";

export type NativeCommandSessionPort = {
  queuePendingCommand(request: {
    kind: string;
    authority?: NativeDeferredCommandAuthority;
    payload?: unknown;
  }): NativeEditQueueCommandResult;
  takePendingCommand(): NativeEditQueuedCommand | null;
};

export type NativeDeferredCommandContext = {
  session: NativeCommandSessionPort;
  lease: NativeEditLeaseStamp;
};

export type PendingNativeCommandCallback = {
  sequence: number;
  kind: string;
  authority: NativeDeferredCommandAuthority;
  session: NativeCommandSessionPort;
  lease: NativeEditLeaseStamp;
  run: () => void;
  onDiscard?: (reason: NativeDeferredCommandDiscardReason) => void;
};

export function nativeEditLeasesMatch(
  left: NativeEditLeaseStamp | null,
  right: NativeEditLeaseStamp,
): boolean {
  return Boolean(
    left
    && left.sessionId === right.sessionId
    && left.domGeneration === right.domGeneration
    && left.sourceRevision === right.sourceRevision
    && left.hostId === right.hostId
  );
}

function notifyDiscard(
  callback: PendingNativeCommandCallback | null,
  reason: NativeDeferredCommandDiscardReason,
): void {
  if (!callback?.onDiscard) return;
  try {
    callback.onDiscard(reason);
  } catch {
    // Cancellation notification is bookkeeping only. It must never revive a
    // stale command or interrupt the source-authority session teardown.
  }
}

export class NativeDeferredCommandQueue {
  #pending: PendingNativeCommandCallback | null = null;
  #scheduled: PendingNativeCommandCallback | null = null;

  discardPendingNativeCommands(reason: NativeDeferredCommandDiscardReason): void {
    const pending = this.#pending;
    const scheduled = this.#scheduled;
    this.#pending = null;
    this.#scheduled = null;
    notifyDiscard(pending, reason);
    if (scheduled && scheduled !== pending) {
      notifyDiscard(scheduled, reason);
    }
  }

  deferNativeCommand(
    kind: string,
    run: () => void,
    payload: unknown,
    options: NativeDeferredCommandOptions,
    active: NativeDeferredCommandContext | null,
  ): boolean {
    if (!active) return false;
    const authority = options.authority ?? "user-explicit";
    const incumbent = this.#pending ?? this.#scheduled;
    if (authority === "system" && incumbent?.authority === "user-explicit") {
      try {
        options.onDiscard?.("blocked-by-user-command");
      } catch {
        // A lower-priority system callback is already fully discarded.
      }
      return true;
    }
    const queued = active.session.queuePendingCommand({
      kind,
      authority,
      payload,
    });
    if (!queued.queued) return false;
    this.discardPendingNativeCommands("superseded");
    this.#pending = {
      sequence: queued.sequence,
      kind,
      authority,
      session: active.session,
      lease: { ...active.lease },
      run,
      onDiscard: options.onDiscard,
    };
    return true;
  }

  takeReplayableNativeCommandForCompletedSession(
    active: NativeDeferredCommandContext,
    currentLease: NativeEditLeaseStamp | null,
  ): PendingNativeCommandCallback | null {
    const pending = this.#pending;
    const scheduled = this.#scheduled;
    const callback = pending ?? scheduled;
    if (
      !callback
      || callback.authority !== "user-explicit"
      || callback.session !== active.session
      || !nativeEditLeasesMatch(currentLease, callback.lease)
      || !nativeEditLeasesMatch(active.lease, callback.lease)
    ) return null;
    if (callback === pending) {
      const command = active.session.takePendingCommand();
      if (
        !command
        || command.sequence !== callback.sequence
        || command.kind !== callback.kind
      ) return null;
      this.#pending = null;
    } else {
      this.#scheduled = null;
    }
    return callback;
  }

  scheduleReplay(
    callback: PendingNativeCommandCallback,
    schedule: (run: () => void) => void,
  ): void {
    this.#scheduled = callback;
    schedule(() => {
      if (this.#scheduled !== callback) return;
      this.#scheduled = null;
      callback.run();
    });
  }

  drainPendingNativeCommand(
    session: NativeCommandSessionPort,
    context: {
      getActive: () => NativeDeferredCommandContext | null;
      getCurrentLease: () => NativeEditLeaseStamp | null;
      schedule: (run: () => void) => void;
    },
  ): void {
    const active = context.getActive();
    const pending = this.#pending;
    if (
      !active
      || !pending
      || active.session !== session
      || pending.session !== session
      || !nativeEditLeasesMatch(context.getCurrentLease(), pending.lease)
      || !nativeEditLeasesMatch(active.lease, pending.lease)
    ) {
      if (pending?.session === session) {
        this.#pending = null;
        notifyDiscard(pending, "stale-session");
      }
      return;
    }
    const command = session.takePendingCommand();
    if (!command || command.sequence !== pending.sequence || command.kind !== pending.kind) {
      if (command) {
        this.#pending = null;
        notifyDiscard(pending, "stale-session");
      }
      return;
    }
    this.#pending = null;
    this.#scheduled = pending;
    context.schedule(() => {
      const current = context.getActive();
      if (
        this.#scheduled !== pending
        || !current
        || current.session !== session
        || !nativeEditLeasesMatch(context.getCurrentLease(), pending.lease)
      ) {
        if (this.#scheduled === pending) {
          this.#scheduled = null;
          notifyDiscard(pending, "stale-session");
        }
        return;
      }
      this.#scheduled = null;
      pending.run();
    });
  }
}
