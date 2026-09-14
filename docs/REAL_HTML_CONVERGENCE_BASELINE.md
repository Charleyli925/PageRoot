# Real HTML convergence baseline

This record freezes the calibration performed for the real-HTML scenario
convergence work. It is evidence for the M1 commit only; it is not a claim
that a private corpus was executed.

## Source and environment

| Field | Value |
| --- | --- |
| Base | `origin/main` |
| HEAD | `8d237071add5a98a9b7d523cc7e3dced4e93a89b` |
| Tree | `9a447beaf910cc4af65501118dda5f99cc7ad435` |
| Workspace source SHA-256 | `3df8c3d99b55df0685b6d91fd807ff674be2b5925d7fa4de99d534dde757622f` |
| Untracked source files | `0` |
| Node / npm | `v25.7.0` / `11.10.1` (repository guidance targets Node 22) |
| Private corpus | not supplied in this worktree; no private HTML was read |

The primary checkout's unrelated review-diagnosis files were left untouched.
All implementation and generated evidence for this task lives in the isolated
task worktree.

## Entry calibration

| Entry | Current implementation | M1 disposition |
| --- | --- | --- |
| `npm run test:real-html` | Browser DOM compatibility scan via `playwright.real-html.config.mjs` | Keep as a compatibility alias; it is not native-input acceptance |
| `npm run test:real-html:electron` | Builds the renderer and invokes `local-html-corpus.mjs` | Replace with the frozen scenario dispatcher in M3 |
| `local-html-corpus.mjs` | Full local-corpus runner with capability preflight and retired automatic qualification guard | Keep as the explicit read-only preflight implementation; do not re-enable discovery qualification |
| `frozen-html-operation.mjs` | Executes one reviewed frozen manifest | Keep as the low-level scenario executor; the new entry will dispatch to it |
| `frozen-html-extended-stress.mjs` | Executes a reviewed multi-target stress manifest | Keep as the cumulative stress executor; it remains on-demand |
| `specialized-real-html-lanes.mjs` | Executes separately scoped paste/IME/race/long-session lanes | Keep independent; the three common scenarios do not replace these boundaries |
| Browser/Electron configs | Inventory-driven Playwright lanes | Keep unchanged in M1; update inventory ownership only when the entry changes |

## Scenario ownership and existing canaries

| Scenario | Existing protection | Planned frozen owner |
| --- | --- | --- |
| A: ordinary edit, format and history continuity | `frozen-html-operation.mjs` with `native-text` / `core-text-format`; `frozen-text.mjs` contracts | Frozen dispatcher scenario `A`, one reviewed text/format manifest |
| B: edit → history → copy → comment → continue | `frozen-html-operation.mjs` with `mixed`; `frozen-mixed.mjs` and comment persistence contracts | Frozen dispatcher scenario `B`, three-cycle mixed manifest |
| C: required rebuild → takeover → continue → reopen | Mixed/structure frozen lifecycle and extended stress contracts | Frozen dispatcher scenario `C`, the small `core-structure-closed-loop` manifest with forced `move-copy`, post-rebuild input/save and reopen; path-race and pressure remain specialized |

The existing result model already creates file, stage and operation rows before
execution and permits only `PASS`, `FAIL`, `NOT_APPLICABLE` and
`NOT_EXECUTED`. The convergence work must adapt executor evidence into that
model, not introduce a second result-state system.

## Baseline verification

The following checks were run against the frozen base:

* `npm run test:inventory` — passed: 38 spec files, 321 Playwright tests, 11 execution lanes, 262 Node tests.
* The real-HTML result, source-scope, stage-contract and extended-stress suites were selected as the representative Node baseline. Pure contract cases passed; one source-scope test initially hit a missing Electron binary after a clean dependency install. The local Electron binary was then restored with the repository-recommended installer command; this environment note is retained rather than silently treating the first attempt as a product failure.
* No private `STEMMIO_REAL_HTML_DIR` run was attempted. Any future absence or empty corpus is `NOT_EXECUTED`/blocked, not synthetic acceptance.

## M1 exit decision

M1 is complete when this record and the frozen plan contracts identify the
three scenario owners, their actual executors, required materials and existing
oracles. No test is deleted by this commit. M2 may now add only the shared
entry/ledger/manifest helpers required to connect those executors.
