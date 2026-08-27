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
): boolean;

export declare class NativeDeferredCommandQueue {
  discardPendingNativeCommands(reason: NativeDeferredCommandDiscardReason): void;
  deferNativeCommand(
    kind: string,
    run: () => void,
    payload: unknown,
    options: NativeDeferredCommandOptions,
    active: NativeDeferredCommandContext | null,
  ): boolean;
  takeReplayableNativeCommandForCompletedSession(
    active: NativeDeferredCommandContext,
    currentLease: NativeEditLeaseStamp | null,
  ): PendingNativeCommandCallback | null;
  scheduleReplay(
    callback: PendingNativeCommandCallback,
    schedule: (run: () => void) => void,
  ): void;
  drainPendingNativeCommand(
    session: NativeCommandSessionPort,
    context: {
      getActive: () => NativeDeferredCommandContext | null;
      getCurrentLease: () => NativeEditLeaseStamp | null;
      schedule: (run: () => void) => void;
    },
  ): void;
}
