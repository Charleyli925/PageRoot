import type { HtmlCanvasTextLocator } from "../components/HtmlCanvasEditor.types";
import type { ActiveTextRange, SourceIndexValue } from "../components/html-canvas-internal-types";

export function createElementTextLocator(
  sourceIndex: SourceIndexValue | null,
  range: ActiveTextRange | null,
): HtmlCanvasTextLocator | null;
