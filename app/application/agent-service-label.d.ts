export const AGENT_SERVICE_ORDER: readonly ["pageroot", "qoder", "codex"];

export const AGENT_SERVICE_LABELS: Readonly<{
  pageroot: "内置 AI";
  qoder: "Qoder";
  codex: "Codex";
}>;

export function agentServiceLabel(providerId: unknown): string;

export function agentServiceStatusText(options?: {
  availability?: Readonly<{ status?: string; reason?: string | null }> | null;
  installState?: string | null;
  activeOperation?: Readonly<{ kind?: string; state?: string }> | null;
  connection?: Readonly<{ vendorDisplayName?: string | null }> | null;
  isDefault?: boolean;
  providerId?: string | null;
  modelDisplayName?: string | null;
}): string;

export function agentServicePrimaryAction(options?: {
  availability?: Readonly<{ status?: string; reason?: string | null }> | null;
  isDefault?: boolean;
}): Readonly<{ kind: "connect" | "manage" | "default"; label: string }>;

export function sidebarServiceTriggerText(options?: {
  providerId?: string | null;
  catalogStatus?: string;
  connectionVendorName?: string | null;
  modelDisplayName?: string | null;
}): string;
