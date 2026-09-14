const DEFAULT_DELETE_MESSAGE = /^确定删除“[^”]+”及其全部内容吗？/u;

function fail(code, details = {}) {
  throw Object.assign(new Error(code), { code, details });
}

/**
 * Handle exactly one delete confirmation that the test registered in advance.
 * Playwright dialogs must be accepted or dismissed; an unexpected dialog is
 * never silently consumed to keep a scenario moving.
 */
export async function withExpectedDeleteConfirmation(page, action, {
  messagePattern = DEFAULT_DELETE_MESSAGE,
  decision = "accept",
} = {}) {
  if (!page || typeof page.on !== "function" || typeof page.off !== "function") {
    fail("FROZEN_DELETE_DIALOG_PAGE_INVALID");
  }
  if (!messagePattern || !["accept", "dismiss"].includes(decision)) {
    fail("FROZEN_DELETE_DIALOG_EXPECTATION_INVALID");
  }
  const seen = [];
  const handler = async (dialog) => {
    const type = dialog.type();
    const message = dialog.message();
    const expected = type === "confirm"
      && (messagePattern instanceof RegExp ? messagePattern.test(message) : messagePattern(message));
    seen.push({ type, message, expected });
    if (!expected) {
      await dialog.dismiss();
      return;
    }
    if (decision === "accept") await dialog.accept();
    else await dialog.dismiss();
  };
  page.on("dialog", handler);
  try {
    const result = await action();
    if (seen.length !== 1 || !seen[0].expected) {
      fail("FROZEN_DELETE_DIALOG_EXPECTATION_MISSED", { seen });
    }
    return { result, dialog: seen[0], decision };
  } finally {
    page.off("dialog", handler);
  }
}

export { DEFAULT_DELETE_MESSAGE };
