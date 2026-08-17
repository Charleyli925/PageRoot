# Native DOM browser and Electron gates

These suites exercise the real PageRoot canvas in Chromium and Electron. The
browser fixtures load through the existing browser file input; the Electron
disk-transaction gate starts from an isolated desktop recent-project record
and opens a real temporary HTML file through the production project IPC. Both
paths enter the same-origin edit iframe and operate authored DOM with real
mouse, keyboard, Selection, clipboard, `beforeinput`, and Chromium composition
events. They do not inject an editor implementation.

The gates require the authored fixture element itself to become the measured
`plaintext-only` host or the controlled `contenteditable="true"` fallback,
with browser-native Selection, caret, `beforeinput`, composition and guarded
mutation behavior. A passing build keeps the iframe `Document` alive during
typing, creates no substitute editing surface, and persists only the minimal
PageRoot SourcePatch transaction.

## Dependency condition

The repository declares Playwright as a development test dependency. Install
the matching Chromium binary once for the current lockfile, then run:

```sh
npx playwright install chromium
npx playwright test --config tests/e2e/browser/playwright.config.mjs
```

An explicitly chosen already-running server can be used without letting the
config start one:

```sh
PAGEROOT_BASE_URL=http://127.0.0.1:3000 \
  npx playwright test --config tests/e2e/browser/playwright.config.mjs
```

Without `PAGEROOT_BASE_URL`, the gate starts this checkout's production server
and refuses to silently reuse another process already listening on port 3000.

For Electron, build the renderer first, then run the isolated app tests:

```sh
npm run desktop:renderer
npx playwright test --config tests/e2e/electron/playwright.config.mjs
```

The final comment-to-AI loop has a separate deterministic Electron gate:

```sh
npm run test:ai-closed-loop:smoke
npm run test:ai-closed-loop
```

It creates an isolated temporary HTML and workspace, adds a comment through the
real canvas UI, freezes and copies the handoff, generates a controlled AI result, runs the
official finalizer, then proves that PageRoot creates and automatically opens a
new non-overwriting working HTML. It also injects clipboard-copy failure,
missing finalizer, malformed HTML, out-of-scope output, and generated-version
activation failure.
The suite never pauses for a person or an external model. Its oracle is the
frozen input, generated output, scope report, finalizer records and exact files
opened by the production application.

Electron tests pass a dedicated `PAGEROOT_E2E_USER_DATA_DIR` that is accepted
only when `PAGEROOT_E2E=1` and the path is an isolated
`pageroot-native-e2e-*` directory under the system temporary directory. They
run the native window hidden by default, keep its renderer unthrottled, place
the bridge workspace inside that directory, remove only validated test
directories, and never change `HOME` or open the user's real HTML project. Set
`PAGEROOT_E2E_FOREGROUND=1` only for deliberate visual debugging. Background
mode keeps the macOS Dock icon (click it to inspect or minimize the window)
and all E2E modes suppress automatically triggered native dialogs, logging
them instead. The real-file case checkpoints and autosaves a temporary disk
HTML, proves that
only the authorized bytes changed, and then closes and reopens the app against
the same forward result.

## Coverage and release interpretation

This document defines gates; it does not record a pass for the current HEAD.
Results become release evidence only when every command is rerun against the
same final commit and content hash recorded by the automated gate report.

- `native-dom-editing.spec.mjs`: all three capability modes, authored-host
  activation, layout invariance, mouse/keyboard Selection, clipboard,
  beforeinput, composition, and toolbar focus.
- `native-dom-boundaries.spec.mjs`: iframe/script boundary, persistent
  Document identity, scroll stability, rapid typing, target ranges, long
  tasks, shared hover/click hits, filled-module padding, empty modules, and
  dedicated canvas roots.
- `native-dom-source.spec.mjs`: byte-exact UTF-8 replacement, BOM/CRLF,
  entities/quotes/comments/duplicate attributes, exact forward bytes, and
  blocked source-reversal shortcuts.
- `native-dom-electron.spec.mjs`: the same real native editing path in the
  shipped Chromium environment, plus temporary-disk checkpoint/autosave,
  exact forward bytes, graceful close, and cold reopen consistency.
- `conflict-force-unlock.spec.mjs`: external Working Copy change surfaces the
  conflict banner (including after reopening an already imported project), and
  confirmed “采用磁盘版本” restores an editable idle project without rewriting
  the on-disk HTML. This spec is in the full Electron lane, not the smoke grep.
  Run it locally after `npm run desktop:renderer`:

  ```sh
  npx playwright test --config tests/e2e/electron/playwright.config.mjs \
    tests/e2e/electron/conflict-force-unlock.spec.mjs
  ```
- `ai-handoff-closed-loop.spec.mjs`: real comment UI, frozen Request, clipboard
  handoff, generated-AI/finalizer result, status polling, non-overwriting Version
  creation, automatic working-HTML activation, and fail-closed recovery paths.
- `packaged-runtime-smoke.spec.mjs`: the packaged `.app` executable, isolated
  user data, authored-DOM input and byte-exact export without source-runtime substitution.

The capability assertions use the same production contract as the canvas:

- `native-editable`: the real authored element owns the caret and is directly
  editable.
- `select-comment`: native selection remains available, while direct mutation
  is withheld and the user is guided to a selection-scoped comment.
- `comment-only`: structurally generated or non-uniquely mapped content remains
  untouched and accepts only module/subregion comments.

Every source test treats the imported HTML bytes as the oracle. BOM, line
endings, entities, quotes, comments, duplicate attributes, formatting, and all
other bytes outside the approved SourcePatch ranges must remain unchanged.
The canvas has no DOM or component-local undo/redo stack. Source-reversal
shortcuts route through the document-owned, persistent byte-patch journal;
every undo/redo must validate the exact current and resulting source hashes.
Native undo remains local to focused comment and project-rule text fields.
A DOM serialization that merely renders the same page is a failure.

Playwright traces, screenshots, videos and reports are written only below
`output/playwright/`.

## Automated real-file gate

The gate uses `tests/fixtures/native-dom/complex-layout.html` by default, so it
is deterministic and unattended:

```sh
npm run test:real-html
```

An absolute local sample can optionally replace that input without changing
the test logic:

```sh
PAGEROOT_REAL_HTML_PATH='/absolute/path/to/complex-page.html' npm run test:real-html
```

An override path must be an absolute existing `.html` file. The test reads it into a
Buffer and imports that buffer through the browser file input; it never writes
the original file. The config has `retries: 0`, uses only
`real-complex-html.gate.mjs`, and writes its artifacts under
`output/playwright/real-complex-html/`. A missing safe editable target or an
explicit `select-comment`/`comment-only` target fails with candidate
diagnostics instead of weakening the assertions.

The current capability manifest contains 23 cases. If `cases.json` changes,
the release report must use the count from that final file rather than copying
this number or an older test total.
