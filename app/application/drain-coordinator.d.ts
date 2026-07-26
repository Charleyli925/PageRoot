export type DrainBoundary = "close" | "switch" | "submit" | "history";
export type DrainStatus =
  | { state: "resolved" }
  | { state: "pending"; reason?: string }
  | { state: "blocked"; reason: string };
export type DrainResult =
  | { ok: true }
  | { ok: false; obligation: string; reason: string };

export class DrainCoordinator {
  replace(name: string, obligation: {
    label?: string;
    alwaysDrain?: boolean;
    inspect?: (boundary: DrainBoundary) => DrainStatus;
    drain?: (context: {
      boundary: DrainBoundary;
      deadlineAt: number;
    }) => Promise<boolean | void> | boolean | void;
  }): void;
  remove(name: string): void;
  inspect(boundary: DrainBoundary): Array<DrainStatus & {
    name: string;
    label: string;
    alwaysDrain: boolean;
  }>;
  hasPending(boundary: DrainBoundary): boolean;
  drain(
    boundary: DrainBoundary,
    options: { deadlineAt: number },
  ): Promise<DrainResult>;
}
