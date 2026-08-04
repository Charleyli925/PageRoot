import type {
  RawRuntimeVisualProjection,
  RuntimeVisualCapturePayload,
} from "../domain/runtime-visual-projection.js";

export type DesktopEditVisualApi = {
  captureProjection: (
    payload: RuntimeVisualCapturePayload,
  ) => Promise<RawRuntimeVisualProjection>;
};

declare global {
  interface Window {
    htmlAIEditVisuals?: DesktopEditVisualApi;
  }
}
