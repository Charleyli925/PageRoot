import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  evaluateReviewSettlement,
  latestExactReviewRequest,
  reviewedCommitPrefix,
  reviewPriority,
  reviewRequestBaseSha,
  reviewRequestSha,
} from "../scripts/check-pr-review-settled.mjs";

const headSha = "a".repeat(40);
const oldSha = "b".repeat(40);
const baseSha = "c".repeat(40);
const oldBaseSha = "d".repeat(40);
const createdAt = "2026-08-08T03:59:00.000Z";
const requestAt = "2026-08-08T04:00:00.000Z";
const draftCompletedAt = "2026-08-08T04:00:30.000Z";
const readyAt = "2026-08-08T04:01:00.000Z";
const finalCompletedAt = "2026-08-08T04:02:00.000Z";
const reviewGateSource = await readFile(
  new URL("../scripts/check-pr-review-settled.mjs", import.meta.url),
  "utf8",
);

function request({
  sha = headSha,
  base = baseSha,
  createdAt: requestedAt = requestAt,
  updatedAt = requestedAt,
  lastEditedAt = null,
  association = "OWNER",
  id = 10,
  body = null,
} = {}) {
  return {
    id,
    body: body ?? `@codex review\n\nReview exact head SHA \`${sha}\` on base SHA \`${base}\`.\n\n<!-- pageroot-codex-review-sha:${sha};base-sha:${base} -->`,
    user: { login: "maintainer" },
    author_association: association,
    created_at: requestedAt,
    updated_at: updatedAt,
    lastEditedAt,
  };
}

function pullRequest({
  sha = headSha,
  base = baseSha,
  draft = false,
  state = "open",
  created = createdAt,
} = {}) {
  return {
    head: { sha },
    base: { sha: base },
    draft,
    state,
    created_at: created,
  };
}

function codexReview({
  sha = headSha,
  submittedAt = finalCompletedAt,
  id = 20,
  state = "COMMENTED",
  body = null,
  actor = "chatgpt-codex-connector[bot]",
} = {}) {
  return {
    id,
    user: { login: actor },
    commit_id: sha,
    submitted_at: submittedAt,
    state,
    body: body ?? `\n### 💡 Codex Review\n\n**Reviewed commit:** \`${sha.slice(0, 10)}\``,
  };
}

function draftReview(overrides = {}) {
  return codexReview({ id: 19, submittedAt: draftCompletedAt, ...overrides });
}

function reaction({
  createdAt: reactedAt = finalCompletedAt,
  id = 40,
  content = "+1",
  actor = "chatgpt-codex-connector[bot]",
} = {}) {
  return {
    id,
    user: { login: actor },
    content,
    created_at: reactedAt,
  };
}

function cleanComment({
  sha = headSha,
  createdAt: completedAt = finalCompletedAt,
  updatedAt = completedAt,
  lastEditedAt = null,
  id = 50,
  actor = "chatgpt-codex-connector[bot]",
  body = null,
} = {}) {
  return {
    id,
    user: { login: actor },
    created_at: completedAt,
    updated_at: updatedAt,
    lastEditedAt,
    body: body ?? `Codex Review: Didn't find any major issues. Breezy!\n\n**Reviewed commit:** \`${sha.slice(0, 10)}\``,
  };
}

function codexThread({
  priority = "P2",
  resolved = false,
  outdated = false,
  path = "scripts/example.mjs",
  actor = "chatgpt-codex-connector",
  body = null,
} = {}) {
  return {
    isResolved: resolved,
    isOutdated: outdated,
    comments: {
      nodes: [{
        databaseId: 30,
        author: { login: actor },
        path,
        body: body ?? `**![${priority} Badge](https://example.test/${priority}) Finding**`,
      }],
    },
  };
}

function evaluate(overrides = {}) {
  return evaluateReviewSettlement({
    expectedHeadSha: headSha,
    expectedBaseSha: baseSha,
    pullRequest: pullRequest(),
    issueComments: [request()],
    timelineEvents: [{ id: 15, event: "ready_for_review", created_at: readyAt }],
    reviews: [draftReview(), codexReview()],
    requestReactions: [],
    pullRequestReactions: [],
    reviewThreads: [],
    now: new Date("2026-08-08T04:05:01.000Z"),
    settleSeconds: 180,
    ...overrides,
  });
}

test("the Draft request is one immutable exact head/base protocol message", () => {
  assert.equal(reviewRequestSha(request().body), headSha);
  assert.equal(reviewRequestBaseSha(request().body), baseSha);
  assert.equal(reviewedCommitPrefix("**Reviewed commit:** `aaaaaaaaaa`"), "aaaaaaaaaa");
  assert.equal(reviewPriority("![P1 Badge](badge)"), "P1");

  const latest = latestExactReviewRequest([
    request({ id: 1, createdAt: "2026-08-08T03:30:00.000Z" }),
    request({ id: 2, createdAt: "2026-08-08T03:45:00.000Z" }),
    request({ id: 3, association: "CONTRIBUTOR" }),
    request({
      id: 4,
      createdAt: "2026-08-08T03:50:00.000Z",
      updatedAt: "2026-08-08T03:51:00.000Z",
    }),
    request({ id: 5, base: oldBaseSha }),
    request({
      id: 6,
      createdAt: "2026-08-08T03:55:00.000Z",
      updatedAt: "2026-08-08T03:55:00.000Z",
      lastEditedAt: "2026-08-08T03:55:00.000Z",
    }),
  ], headSha, baseSha);
  assert.equal(latest.id, 2);
});

test("GitHub issue-comment evidence includes edit-specific GraphQL metadata", () => {
  assert.match(
    reviewGateSource,
    /comments\(first: 100, after: \$after\)[\s\S]+lastEditedAt[\s\S]+authorAssociation/u,
  );
  assert.doesNotMatch(
    reviewGateSource,
    /restPages\(apiBase, `\$\{basePath\}\/issues\/\$\{options\.pullRequest\}\/comments`/u,
  );
});

test("non-protocol Markdown is ignored instead of being parsed as review evidence", () => {
  const deviations = [
    "@codex review",
    `- @codex review\n\nReview exact head SHA \`${headSha}\` on base SHA \`${baseSha}\`.`,
    `> @codex review\n\nReview exact head SHA \`${headSha}\` on base SHA \`${baseSha}\`.`,
    `\`\`\`text\n@codex review\n\`\`\``,
    `- \`\`\`text\n  @codex review\n  \`\`\``,
    `${request().body}\nextra visible text`,
    request().body.replace(`Review exact head SHA \`${headSha}\``, `Review exact head SHA \`${oldSha}\``),
    request().body.replace(`;base-sha:${baseSha}`, ""),
    `${request().body}\n<!-- pageroot-codex-review-sha:${headSha};base-sha:${baseSha} -->`,
  ];
  for (const body of deviations) {
    assert.equal(reviewRequestSha(body), null, body);
    assert.equal(reviewRequestBaseSha(body), null, body);
  }

  const unrelatedHistory = deviations.map((body, index) => request({
    id: 100 + index,
    body,
    createdAt: `2026-08-08T03:${String(30 + index).padStart(2, "0")}:00.000Z`,
  }));
  assert.equal(evaluate({
    issueComments: [...unrelatedHistory, request()],
  }).status, "settled");
});

test("substantive exact-commit reviews settle both phases", () => {
  const result = evaluate();
  assert.equal(result.status, "settled");
  assert.equal(result.draftCompletion.kind, "substantive_review");
  assert.equal(result.draftCompletion.at, draftCompletedAt);
  assert.equal(result.completion.kind, "substantive_review");
  assert.equal(result.completion.at, finalCompletedAt);
});

test("clean reactions settle only inside their Draft or Ready phase", () => {
  const requestThumb = reaction({
    id: 41,
    createdAt: draftCompletedAt,
    content: "THUMBS_UP",
  });
  const readyThumb = reaction({ id: 42, createdAt: finalCompletedAt });
  const result = evaluate({
    reviews: [],
    requestReactions: [requestThumb],
    pullRequestReactions: [readyThumb],
  });
  assert.equal(result.status, "settled");
  assert.equal(result.draftCompletion.scope, "request_comment");
  assert.equal(result.completion.scope, "pull_request");

  assert.equal(evaluate({
    reviews: [codexReview()],
    requestReactions: [reaction({ createdAt: finalCompletedAt })],
  }).reason, "draft_review_not_completed_before_promotion");
  assert.equal(evaluate({
    reviews: [draftReview()],
    pullRequestReactions: [reaction({ createdAt: draftCompletedAt })],
  }).reason, "final_review_in_progress");
});

test("a PR-level clean reaction may prove the frozen Draft pair before Ready", () => {
  const result = evaluate({
    reviews: [codexReview()],
    pullRequestReactions: [reaction({
      id: 43,
      createdAt: draftCompletedAt,
      content: "THUMBS_UP",
    })],
  });
  assert.equal(result.status, "settled");
  assert.equal(result.draftCompletion.scope, "pull_request");
});

test("an immutable exact-commit clean comment survives Ready replacing the Draft reaction", () => {
  const firstSnapshot = evaluate({
    reviews: [],
    pullRequestReactions: [reaction({
      id: 43,
      createdAt: draftCompletedAt,
    })],
  });
  assert.equal(firstSnapshot.reason, "final_review_in_progress");
  assert.equal(firstSnapshot.draftCompletion.scope, "pull_request");

  const laterSnapshot = evaluate({
    issueComments: [
      request(),
      cleanComment({ id: 51, createdAt: draftCompletedAt }),
      cleanComment({ id: 52, createdAt: finalCompletedAt }),
    ],
    reviews: [],
    pullRequestReactions: [],
  });
  assert.equal(laterSnapshot.status, "settled");
  assert.equal(laterSnapshot.draftCompletion.kind, "clean_review_comment");
  assert.equal(laterSnapshot.completion.kind, "clean_review_comment");
});

test("empty, unmarked, stale, human and wrong-commit records are never completions", () => {
  const emptyDraft = draftReview({ body: "" });
  const emptyFinal = codexReview({ body: "" });
  const linkOnlyFinal = codexReview({ body: "### 💡 Codex Review\n\nhttps://example.test/finding" });
  const wrongCommitFinal = codexReview({ sha: oldSha });
  const humanFinal = codexReview({ actor: "maintainer" });
  const eyes = reaction({ content: "EYES" });

  assert.equal(evaluate({
    reviews: [emptyDraft, codexReview()],
  }).reason, "draft_review_not_completed_before_promotion");
  for (const noise of [emptyFinal, linkOnlyFinal, wrongCommitFinal, humanFinal]) {
    assert.equal(evaluate({
      reviews: [draftReview(), noise],
    }).reason, "final_review_in_progress");
  }
  assert.equal(evaluate({
    reviews: [draftReview()],
    pullRequestReactions: [eyes],
  }).reason, "final_review_in_progress");

  const commentNoise = [
    cleanComment({ sha: oldSha }),
    cleanComment({ actor: "maintainer" }),
    cleanComment({
      updatedAt: "2026-08-08T04:02:01.000Z",
    }),
    cleanComment({
      lastEditedAt: finalCompletedAt,
    }),
    cleanComment({
      body: "Codex Review: Didn't find any major issues. Breezy!",
    }),
    cleanComment({
      body: `Ordinary Codex discussion.\n\n**Reviewed commit:** \`${headSha.slice(0, 10)}\``,
    }),
  ];
  for (const noise of commentNoise) {
    assert.equal(evaluate({
      issueComments: [request(), noise],
      reviews: [draftReview()],
    }).reason, "final_review_in_progress");
  }
});

test("completion requires a matching body marker as well as GitHub commit identity", () => {
  assert.equal(evaluate({
    reviews: [draftReview(), codexReview({
      body: `**Reviewed commit:** \`${oldSha.slice(0, 10)}\``,
    })],
  }).reason, "final_review_in_progress");
  assert.equal(evaluate({
    reviews: [draftReview(), codexReview({
      body: `**Reviewed commit:** \`${headSha.slice(0, 9)}\``,
    })],
  }).reason, "final_review_in_progress");
  assert.equal(evaluate({
    reviews: [draftReview(), codexReview({ state: "PENDING" })],
  }).reason, "final_review_in_progress");
});

test("live identity and phase ordering invalidate stale evidence", () => {
  const cases = [
    ["head_sha_changed", { pullRequest: pullRequest({ sha: oldSha }) }],
    ["base_sha_changed", { pullRequest: pullRequest({ base: oldBaseSha }) }],
    ["exact_sha_review_not_requested", { issueComments: [request({ base: oldBaseSha })] }],
    ["exact_sha_request_not_in_latest_draft", {
      issueComments: [request({ createdAt: "2026-08-08T04:01:10.000Z" })],
    }],
    ["draft_review_not_completed_before_promotion", {
      reviews: [draftReview({ submittedAt: readyAt }), codexReview()],
    }],
    ["final_review_in_progress", {
      reviews: [draftReview(), codexReview({ submittedAt: draftCompletedAt })],
    }],
  ];
  for (const [reason, overrides] of cases) {
    assert.equal(evaluate(overrides).reason, reason);
  }
});

test("one head cannot reuse completion evidence across canonical base requests", () => {
  for (const conflictingRequest of [
    request({
      id: 76,
      base: oldBaseSha,
      createdAt: "2026-08-08T03:30:00.000Z",
    }),
    request({
      id: 77,
      base: oldBaseSha,
      createdAt: "2026-08-08T04:00:10.000Z",
    }),
  ]) {
    assert.equal(evaluate({
      issueComments: [request(), conflictingRequest],
    }).reason, "same_head_cross_base_request_ambiguous");
  }

  assert.equal(evaluate({
    issueComments: [
      request(),
      request({
        id: 78,
        sha: oldSha,
        base: oldBaseSha,
        createdAt: "2026-08-08T03:30:00.000Z",
      }),
    ],
  }).status, "settled");

  assert.equal(evaluate({
    issueComments: [request({ lastEditedAt: requestAt })],
  }).reason, "exact_sha_review_not_requested");
});

test("second-resolution causal boundaries fail closed", () => {
  assert.equal(evaluate({
    issueComments: [request({ createdAt })],
  }).reason, "exact_sha_request_not_in_latest_draft");
  assert.equal(evaluate({
    reviews: [draftReview({ submittedAt: requestAt }), codexReview()],
  }).reason, "draft_review_not_completed_before_promotion");
  assert.equal(evaluate({
    reviews: [codexReview()],
    requestReactions: [reaction({ createdAt: requestAt })],
  }).reason, "draft_review_not_completed_before_promotion");
  assert.equal(evaluate({
    issueComments: [request(), cleanComment({ createdAt: requestAt })],
    reviews: [codexReview()],
  }).reason, "draft_review_not_completed_before_promotion");
  assert.equal(evaluate({
    reviews: [draftReview(), codexReview({ submittedAt: readyAt })],
  }).reason, "final_review_in_progress");
  assert.equal(evaluate({
    reviews: [draftReview()],
    pullRequestReactions: [reaction({ createdAt: readyAt })],
  }).reason, "final_review_in_progress");
  assert.equal(evaluate({
    issueComments: [request(), cleanComment({ createdAt: readyAt })],
    reviews: [draftReview()],
  }).reason, "final_review_in_progress");
  assert.equal(evaluate({
    timelineEvents: [
      { id: 81, event: "convert_to_draft", created_at: readyAt },
      { id: 82, event: "ready_for_review", created_at: readyAt },
    ],
  }).reason, "draft_ready_order_ambiguous");
});

test("the latest Draft interval cannot recycle an earlier promotion", () => {
  const repeatedTimeline = [
    { id: 70, event: "ready_for_review", created_at: readyAt },
    { id: 71, event: "convert_to_draft", created_at: "2026-08-08T04:03:00.000Z" },
    { id: 72, event: "ready_for_review", created_at: "2026-08-08T04:04:00.000Z" },
  ];
  assert.equal(evaluate({
    timelineEvents: repeatedTimeline,
    now: new Date("2026-08-08T04:08:01.000Z"),
  }).reason, "exact_sha_request_not_in_latest_draft");

  const secondRequest = request({
    id: 73,
    createdAt: "2026-08-08T04:03:10.000Z",
  });
  const secondDraftCompletion = codexReview({
    id: 74,
    submittedAt: "2026-08-08T04:03:30.000Z",
  });
  assert.equal(evaluate({
    issueComments: [secondRequest],
    timelineEvents: repeatedTimeline,
    reviews: [secondDraftCompletion, codexReview({
      id: 75,
      submittedAt: "2026-08-08T04:05:00.000Z",
    })],
    now: new Date("2026-08-08T04:08:01.000Z"),
  }).status, "settled");
});

test("Codex environment failures fail closed until newer completion evidence exists", () => {
  const draftFailure = {
    id: 60,
    user: { login: "chatgpt-codex-connector" },
    created_at: "2026-08-08T04:00:20.000Z",
    body: "To use Codex here, create an environment for this repo.",
  };
  assert.equal(evaluate({
    issueComments: [request(), draftFailure],
    reviews: [codexReview()],
  }).reason, "draft_review_environment_unavailable");
  assert.equal(evaluate({
    issueComments: [request(), draftFailure],
  }).status, "settled");
  assert.equal(evaluate({
    issueComments: [request(), {
      ...draftFailure,
      created_at: draftCompletedAt,
    }],
  }).reason, "draft_review_environment_unavailable");

  const finalFailure = {
    ...draftFailure,
    id: 61,
    created_at: "2026-08-08T04:02:30.000Z",
  };
  assert.equal(evaluate({
    issueComments: [request(), finalFailure],
    reviews: [draftReview(), codexReview()],
  }).reason, "final_review_environment_unavailable");
  assert.equal(evaluate({
    issueComments: [request(), finalFailure],
    reviews: [draftReview(), codexReview({
      submittedAt: "2026-08-08T04:03:00.000Z",
    })],
    now: new Date("2026-08-08T04:06:01.000Z"),
  }).status, "settled");
});

test("the settle window begins at real completion and extends to the latest signal", () => {
  const beforeBoundary = evaluate({
    now: new Date("2026-08-08T04:04:59.999Z"),
  });
  assert.equal(beforeBoundary.status, "waiting");
  assert.equal(beforeBoundary.reason, "settle_window");
  assert.equal(beforeBoundary.settlesAt, "2026-08-08T04:05:00.000Z");

  const laterCleanSignal = reaction({ createdAt: "2026-08-08T04:02:30.000Z" });
  const extended = evaluate({
    pullRequestReactions: [laterCleanSignal],
  });
  assert.equal(extended.reason, "settle_window");
  assert.equal(extended.settlesAt, "2026-08-08T04:05:30.000Z");
});

test("active current Codex P0-P2 and unclassified threads block after settlement", () => {
  for (const priority of ["P0", "P1", "P2"]) {
    const result = evaluate({ reviewThreads: [codexThread({ priority })] });
    assert.equal(result.status, "blocked");
    assert.equal(result.reason, "unresolved_blocking_threads");
    assert.equal(result.blockingThreads[0].priority, priority);
  }
  assert.equal(evaluate({
    reviewThreads: [codexThread({ body: "Codex finding without a priority badge." })],
  }).reason, "unresolved_blocking_threads");
  assert.equal(evaluate({
    reviewThreads: [
      codexThread({ priority: "P1", resolved: true }),
      codexThread({ priority: "P2", outdated: true }),
      codexThread({ priority: "P3" }),
      codexThread({ priority: "P1", actor: "maintainer" }),
    ],
  }).status, "settled");
});

test("promotion state failures never unlock the complete matrix", () => {
  const cases = [
    ["ready_transition_missing", { timelineEvents: [] }],
    ["pull_request_is_draft", { pullRequest: pullRequest({ draft: true }) }],
    ["pull_request_not_open", { pullRequest: pullRequest({ state: "closed" }) }],
    ["draft_interval_unavailable", {
      pullRequest: {
        head: { sha: headSha },
        base: { sha: baseSha },
        draft: false,
        state: "open",
      },
    }],
  ];
  for (const [reason, overrides] of cases) {
    assert.equal(evaluate(overrides).reason, reason);
  }
});
