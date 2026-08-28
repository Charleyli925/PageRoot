import {
  useCallback,
  useEffect,
  useRef,
  type RefObject,
} from "react";

export function useCanvasPresentationScroll({
  iframeRef,
  frameGeneration,
  initialScrollTop,
}: {
  iframeRef: RefObject<HTMLIFrameElement | null>;
  frameGeneration: number;
  initialScrollTop?: number;
}) {
  const initialScrollTopRef = useRef(initialScrollTop);
  useEffect(() => {
    initialScrollTopRef.current = initialScrollTop;
  }, [initialScrollTop]);
  const getScrollTop = useCallback(() => Math.max(
    0,
    Number(iframeRef.current?.contentWindow?.scrollY) || 0,
  ), [iframeRef]);
  const scrollToTop = useCallback((scrollTop: number) => {
    const frameWindow = iframeRef.current?.contentWindow;
    if (!frameWindow || !Number.isFinite(Number(scrollTop))) return false;
    frameWindow.scrollTo({
      top: Math.max(0, Number(scrollTop)),
      left: frameWindow.scrollX,
      behavior: "auto",
    });
    return true;
  }, [iframeRef]);
  const restoreInitialScroll = useCallback(() => {
    if (!Number.isFinite(Number(initialScrollTopRef.current))) return false;
    return scrollToTop(Number(initialScrollTopRef.current));
  }, [scrollToTop]);
  useEffect(() => {
    if (!Number.isFinite(Number(initialScrollTop))) return undefined;
    const frame = window.requestAnimationFrame(restoreInitialScroll);
    return () => window.cancelAnimationFrame(frame);
  }, [frameGeneration, initialScrollTop, restoreInitialScroll]);
  return { getScrollTop, restoreInitialScroll, scrollToTop };
}
