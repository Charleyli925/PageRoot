const DEFAULT_DELETE_MESSAGE = /^确定删除“[^”]+”及其全部内容吗？/u;

function fail(code, details = {}) {
  const suffix = Object.keys(details).length > 0 ? `: ${JSON.stringify(details)}` : "";
  throw Object.assign(new Error(`${code}${suffix}`), { code, details });
}

/**
 * Handle exactly one delete confirmation that the test registered in advance.
 * Playwright dialogs must be accepted or dismissed; an unexpected dialog is
 * never silently consumed to keep a scenario moving.
 */
export async function withExpectedDeleteConfirmation(page, action, {
  messagePattern = DEFAULT_DELETE_MESSAGE,
  targetText = null,
  decision = "accept",
} = {}) {
  if (!page || typeof page.on !== "function" || typeof page.off !== "function") {
    fail("FROZEN_DELETE_DIALOG_PAGE_INVALID");
  }
  if (!messagePattern || (targetText != null && typeof targetText !== "string")
    || (targetText != null && targetText.trim() === "")
    || !["accept", "dismiss"].includes(decision)) {
    fail("FROZEN_DELETE_DIALOG_EXPECTATION_INVALID");
  }
  const seen = [];
  const pending = new Set();
  const handlerErrors = [];
  const handler = (dialog) => {
    const completion = (async () => {
      const type = dialog.type();
      const message = dialog.message();
      // `selection.label` is a user-facing label such as "列表项 · 文本";
      // extract the quoted label and compare it as a whole. A prefix match is
      // unsafe when two elements share the same first 32 code points.
      const selectedLabel = message.match(/^确定删除“([^”]+)”及其全部内容吗？/u)?.[1] || null;
      const targetMatches = targetText == null || selectedLabel === targetText.trim();
      const patternMatches = messagePattern instanceof RegExp ? messagePattern.test(message) : messagePattern(message);
      const expected = type === "confirm" && targetMatches && patternMatches;
      seen.push({ type, message, selectedLabel, expected });
      if (!expected) {
        await dialog.dismiss();
        return;
      }
      if (decision === "accept") await dialog.accept();
      else await dialog.dismiss();
    })();
    pending.add(completion);
    completion.then(
      () => pending.delete(completion),
      (error) => {
        handlerErrors.push(error);
        pending.delete(completion);
      },
    );
  };
  page.on("dialog", handler);
  try {
    const result = await action();
    await Promise.resolve();
    await Promise.all([...pending]);
    if (handlerErrors.length > 0) throw handlerErrors[0];
    if (seen.length !== 1 || !seen[0].expected) {
      fail("FROZEN_DELETE_DIALOG_EXPECTATION_MISSED", { seen });
    }
    return { result, dialog: seen[0], decision };
  } finally {
    page.off("dialog", handler);
    await Promise.allSettled([...pending]);
  }
}

export { DEFAULT_DELETE_MESSAGE };
