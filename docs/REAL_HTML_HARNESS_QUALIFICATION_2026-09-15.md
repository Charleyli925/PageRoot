# Frozen real-HTML Harness qualification — 2026-09-15

This note records the first qualification increment on top of the merged
`#552` and `#555` combination. It is a reproducibility record, not a private
HTML acceptance report.

## P0 — fixed combination

- Starting `main`: `9ec352557d624555ba9e6ffcd38353de5b0585bc` (the squash merge
  of `#552`; `#555` is already present in this tree as
  `0d2dd4427eb580a8483689bbdf7112c528d58f13`).
- Starting tree: `9b46fe443d812f6894bcb214330c274831ee86f9`; the approved
  source fingerprint is recomputed after each committed qualification head,
  rather than rebound by the child executor during execution.
- Qualification branch: `test/real-html-harness-qualification`.
- Runtime used for the public smoke: Node `v25.7.0`, npm `11.10.1`, Electron
  `43.6.0`, Playwright Test `^1.63.0`.
- The branch is isolated from the primary checkout. No user HTML, private
  paths, credentials, logs, traces or generated binaries are committed.

## P1 — corpus calibration boundary

No user-designated real-HTML corpus is present in this checkout and
`STEMMIO_REAL_HTML_DIR` is unset. The public entry therefore refuses
`--preflight` with `FROZEN_ENTRY_CORPUS_REQUIRED`; no discovery fallback or
private eight-file result is claimed. Re-freezing the eight current identities
remains the next material-dependent step.

## P2 — Harness qualification

The shared entry now requires:

- exact operation-ledger reconciliation by stage, cycle, sequence and target;
- non-empty operation `actual` evidence (including input, save, copy and
  rebuild facts);
- copy output IDs bound to the verified source transaction, including the
  source-leaf proof and fresh-ID proof; C's process-wide structural fallback
  is accepted only when both `copy` and `move-copy` expectations are frozen;
- C continuation input/save/reopen evidence on the same output ID;
- complete, ordered lifecycle records correlated to the rebuild candidate;
- scenario-isolated structural fallback configuration;
- explicit child/build cleanup receipts, with missing receipts treated as an
  environment block; and
- bounded output summaries with complete per-scenario log files.

## P3 — self-proof

The contract suite contains legal positive fixtures and deliberate omissions,
wrong targets, forged copy IDs, wrong continuation IDs, truncated lifecycle
records, bad runtime configuration, missing reports, zero-exit protocol errors,
unconfirmed process cleanup and build failures. The opt-in public smoke uses a
small static page for A/B and a small scripted Runtime page for C, traversing
the actual public entry, real `frozen-html-operation.mjs` children, operations,
child reports and the aggregate report. It passed locally with A/B/C all PASS.

## Deliberately not claimed in this increment

The private eight-file A/B/C matrix, IME/clipboard/focus/竞态专项, 20/50/100
pressure campaigns and installed-app revalidation were not run. They require
the approved corpus and their own gates; synthetic self-proof is not a
substitute for those acceptance boundaries.
