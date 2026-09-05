export function queuedStaticFallbackOracle({
  diskHtml,
  visibleTexts,
  sandbox,
  expectedSnippet,
  expectedVisibleCount,
} = {}) {
  const texts = Array.isArray(visibleTexts) ? visibleTexts.map(String) : [];
  const snippet = String(expectedSnippet || "");
  if (typeof diskHtml !== "string" || !snippet || !diskHtml.includes(snippet)) {
    throw new Error("Working HTML is missing the latest edit.");
  }
  if (!texts.some((text) => text.includes(snippet))) {
    throw new Error("Visible static frame is not the latest Working HTML.");
  }
  if (
    Number.isInteger(expectedVisibleCount)
    && texts.length !== expectedVisibleCount
  ) {
    throw new Error(
      `Visible static frame has ${texts.length} targets, expected ${expectedVisibleCount}.`,
    );
  }
  if (sandbox !== "allow-same-origin") {
    throw new Error("Static fallback must keep scripts disabled.");
  }
}
