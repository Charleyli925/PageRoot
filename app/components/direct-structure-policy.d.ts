import type { SourceIndexValue } from "./html-canvas-internal-types";
import type { HtmlCanvasSelection } from "./HtmlCanvasEditor.types";

export type DirectStructurePolicyStatus =
  | "supported"
  | "unsupported"
  | "temporarily-unavailable";

export type DirectStructurePolicyDecision = Readonly<{
  status: DirectStructurePolicyStatus;
  reason: string;
  message: string;
  copyPolicy?: string;
  beforeElementId?: string | null;
  direction?: "up" | "down";
  landingElementId?: string | null;
}>;

export function evaluateDirectStructurePolicy(input?: Readonly<{
  action?: string | null;
  sourceIndex?: SourceIndexValue | null;
  selection?: HtmlCanvasSelection | null;
  elementId?: string | null;
  destination?: Readonly<Record<string, unknown>> | null;
  html?: string | null;
}>): DirectStructurePolicyDecision;

export function directCopyPolicyForElement(input?: Readonly<{
  sourceIndex?: SourceIndexValue | null;
  selection?: HtmlCanvasSelection | null;
  elementId?: string | null;
  html?: string | null;
}>): DirectStructurePolicyDecision & { copyPolicy: string };

export const copy: typeof directCopyPolicyForElement;
