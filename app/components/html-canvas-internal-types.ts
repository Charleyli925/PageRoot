import { buildSourceIndex } from "../lib/source-patch-core.js";
import type {
  HtmlCanvasFingerprint,
  HtmlCanvasSelection,
  HtmlCanvasTextLocator,
  HtmlCanvasTargetResolution,
} from "./HtmlCanvasEditor.types";

export type SourceIndexValue = ReturnType<typeof buildSourceIndex>;

export type SourceElementValue = {
  type: "element";
  nodeId: string;
  tagName: string;
  parentId: string | null;
  previousElementSiblingId: string | null;
  nextElementSiblingId: string | null;
  childIds: string[];
  childElementIds: string[];
  textNodeIds: string[];
  textContent: string;
  attributes: Array<{
    name: string;
    rawValue?: string | null;
    value?: string | null;
  }>;
  startTagRange: { startOffset: number; endOffset: number };
  attributesByName: Map<string, Array<{
    value?: string | null;
    rawValue?: string | null;
  }>>;
};

export type SourceTargetRef = {
  targetId: string;
  elementId?: string;
  expectedSourceSha256?: string;
  label: string;
  level: "module" | "subregion" | "text" | "insertion-point";
  selector?: string;
  textQuote?: string;
  textLocator?: HtmlCanvasTextLocator;
  sourceAnchor?: HtmlCanvasSelection["sourceAnchor"];
  fingerprint?: HtmlCanvasFingerprint;
  resolution: HtmlCanvasTargetResolution;
};

export type TextRangeSegment = {
  textNodeId: string;
  startOffset: number;
  endOffset: number;
};

export type ActiveTextRange = {
  target: HtmlCanvasSelection;
  segments: TextRangeSegment[];
  text: string;
  styleElements: HTMLElement[];
  direction: "forward" | "backward";
};
