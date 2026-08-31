export type TextLocatorValidationFailure = Readonly<{
  ok: false;
  code: "RUN_SUBMISSION_TEXT_LOCATOR_STALE";
  commentId: string;
  reason: string;
}>;

export type TextLocatorValidationResult<T = unknown> =
  | Readonly<{ ok: true; comments: T[] }>
  | TextLocatorValidationFailure;

export const TEXT_LOCATOR_STALE_REASON: string;

export function revalidateCommentTextLocators<T = Record<string, unknown>>(
  comments: T[],
  html: string,
): TextLocatorValidationResult<T>;
