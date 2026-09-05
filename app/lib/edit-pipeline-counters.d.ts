export interface EditPipelineCounterEvent {
  kind: "sourceIndexBuild" | "fullPatchApply" | "insertionPointFullTreeScan";
  scope: "full-document" | "fragment" | "unlabeled";
  caller: string;
  codeUnitLength?: number;
}

export interface EditPipelineCounterSnapshot {
  sourceIndexBuilds: number;
  fullDocumentIndexBuilds: number;
  fragmentIndexBuilds: number;
  unlabeledIndexBuilds: number;
  fullPatchApplies: number;
  insertionPointFullTreeScans: number;
  events: EditPipelineCounterEvent[];
}

export declare function editPipelineCountersEnabled(): boolean;
export declare function enableEditPipelineCounters(): EditPipelineCounterSnapshot;
export declare function disableEditPipelineCounters(): EditPipelineCounterSnapshot;
export declare function resetEditPipelineCounters(): EditPipelineCounterSnapshot;
export declare function recordEditPipelineCount(
  kind: EditPipelineCounterEvent["kind"],
  details?: {
    scope?: EditPipelineCounterEvent["scope"];
    caller?: string;
    codeUnitLength?: number;
  },
): void;
export declare function readEditPipelineCounters(): EditPipelineCounterSnapshot;
export declare function installEditPipelineTestHooks(
  target?: Window & typeof globalThis,
): void;

declare global {
  interface Window {
    __PAGEROOT_ENABLE_EDIT_PIPELINE_COUNTERS__?: () => EditPipelineCounterSnapshot;
    __PAGEROOT_DISABLE_EDIT_PIPELINE_COUNTERS__?: () => EditPipelineCounterSnapshot;
    __PAGEROOT_RESET_EDIT_PIPELINE_COUNTERS__?: () => EditPipelineCounterSnapshot;
    __PAGEROOT_READ_EDIT_PIPELINE_COUNTERS__?: () => EditPipelineCounterSnapshot;
  }
}
