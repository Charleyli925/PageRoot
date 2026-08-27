export type ProjectOpenPlan =
  | Readonly<{ kind: "ready"; action: "startup" | "browser-picker" | "open-file" | "open-registered" }>
  | Readonly<{ kind: "reject"; code: string; reason: string }>;

export function planProjectOpen(input?: {
  closePhase?: string;
  kind?: string;
  openMode?: string;
}): ProjectOpenPlan;
