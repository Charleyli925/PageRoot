// Relink presentation rules for comments whose targets cannot be proven.
//
// Pure and DOM-free so the load-bearing structure rules stay pinned by a Node
// test instead of only by review:
//
//   - The unsafe set is exactly "has content and cannot be located" — the same
//     predicate submission blocks on, so the rail card's count can never
//     disagree with the block reason.
//   - The durable relink action lives on the comment rail, a persistent
//     surface that page reflow cannot detach. The toast only points at that
//     entry and carries no action of its own: a toast button could be lost to
//     a mid-click reflow with no retry loop for a human (#281).
//
// `canLocateTarget` and `commentHasContent` also live here so the predicate
// has one home; comment-model.ts re-exports them for existing consumers.

/** @param {{ resolution?: string }} target */
export function canLocateTarget(target) {
  return target.resolution === "exact" || target.resolution === "rebound";
}

/**
 * @param {{ text?: string, attachments?: unknown[] }} comment
 * @returns {boolean}
 */
export function commentHasContent(comment) {
  return Boolean(comment.text.trim() || comment.attachments?.length);
}

/**
 * Comments that still carry content but whose targets cannot be proven.
 *
 * @param {ReadonlyArray<import("./types").CommentItem>} comments
 * @returns {import("./types").CommentItem[]}
 */
export function unsafeRelinkComments(comments) {
  return comments.filter(
    (comment) => commentHasContent(comment) && !canLocateTarget(comment.target),
  );
}

/**
 * Copy for the persistent rail card. The card is the durable entry; its words
 * must not promise submission, because relink can also start outside a send.
 *
 * @param {ReadonlyArray<import("./types").CommentItem>} comments
 * @returns {import("./comment-relink-model").RelinkNoticeCopy}
 */
export function relinkNoticeCopy(comments) {
  const count = comments.length;
  return {
    count,
    title: `${count} 条评论需要重新定位`,
    detail: count === 1
      ? "请选择这条评论的新位置，评论和附件已保留。"
      : "将从第 1 条开始，完成后自动进入下一条。",
    actionLabel: count === 1 ? "选择新位置" : "开始重新定位",
  };
}

/**
 * The transient pointer shown when a send is blocked by unsafe targets. It is
 * a background result: the reason lives in the send flow, the recovery entry
 * lives on the rail card, and the toast must not grow a second action.
 *
 * @param {ReadonlyArray<import("./types").CommentItem>} comments
 * @returns {import("./types").Toast}
 */
export function unsafeCommentTargetsNotice(comments) {
  const count = comments.length;
  return {
    title: `${count} 条评论需要重新定位`,
    message: count === 1
      ? "评论和附件已保留；请到“本轮评论”栏顶部选择新位置，之后会自动继续发送。"
      : "评论和附件已保留；请到“本轮评论”栏顶部开始重新定位，全部完成后会自动继续发送。",
    tone: "warning",
    disposition: "background-result",
    dedupeKey: "unsafe-comment-targets",
  };
}
