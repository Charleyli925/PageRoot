import type {
  HtmlCanvasSelection,
  HtmlCanvasSelectionLevel,
} from "../components/HtmlCanvasEditor";

export function targetLevelForSelection(
  level: HtmlCanvasSelectionLevel,
): "module" | "subregion" | "insertion-point";

export function sourceTargetRefForSelection(
  selection: HtmlCanvasSelection,
): {
  targetId: string;
  elementId?: string;
  expectedSourceSha256?: string;
  label: string;
  level: "module" | "subregion" | "insertion-point";
  selector?: string;
  textQuote?: string;
  textLocator?: HtmlCanvasSelection["textLocator"];
  sourceAnchor?: HtmlCanvasSelection["sourceAnchor"];
  fingerprint?: HtmlCanvasSelection["fingerprint"];
  resolution: HtmlCanvasSelection["resolution"];
};

export function rebindCanvasSelectionTargets(
  sourceHtml: string,
  targets: readonly HtmlCanvasSelection[],
): HtmlCanvasSelection[];

export function rebindCanvasSelectionTargetsAcrossHistory(
  currentSourceHtml: string,
  nextSourceHtml: string,
  targets: readonly HtmlCanvasSelection[],
  transition?: {
    fromTarget?: HtmlCanvasSelection | null;
    toTarget?: HtmlCanvasSelection | null;
  },
): HtmlCanvasSelection[];
