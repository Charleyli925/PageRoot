import type { NativeEditSelection } from "../components/NativeEditingController";
import type { SourceTextMap } from "./source-text-map";

export type NativeSourceEditIntent =
  | {
      kind: "insert-text-flow";
      inputType: string;
      text: string;
      selection: NativeEditSelection;
    }
  | {
      kind: "delete-hard-break";
      inputType: "deleteContentBackward" | "deleteContentForward";
      range: {
        startOffset: number;
        endOffset: number;
      };
      selection: NativeEditSelection;
    };

export type NativeStructuralEditPlan = {
  kind: NativeSourceEditIntent["kind"];
  inputType: string;
  command: Record<string, unknown>;
  previousText: string;
  nextText: string;
  selection: NativeEditSelection;
};

export declare const NATIVE_SOURCE_EDIT_KIND: Readonly<{
  INSERT_TEXT_FLOW: "insert-text-flow";
  DELETE_HARD_BREAK: "delete-hard-break";
}>;

export declare class NativeStructuralEditError extends Error {
  code: string;
  details: Record<string, unknown>;
}

export declare function planNativeStructuralEdit(
  sourceMap: SourceTextMap,
  intent: NativeSourceEditIntent,
): NativeStructuralEditPlan;
