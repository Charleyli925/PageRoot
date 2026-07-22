# Native DOM editing fixtures

These fixtures are release-gate inputs for the real authored-DOM editor. They
are deliberately not component mocks and contain no test implementation.

`complex-layout.html` exercises the three public capability outcomes recorded
in `cases.json`. The current manifest has 23 cases; the release report must
recount the final manifest instead of treating this documentation value as a
fixed pass total:

- `native-editable`: the authored element becomes the real editing host and
  must satisfy the complete caret, Selection, beforeinput, clipboard and IME
  contract.
- `select-comment`: native text selection remains, but no editable caret is
  shown; PageRoot must offer a plain-language comment route.
- `comment-only`: the surface stays non-editable and has an element comment
  route.

`source-fidelity.html` contains one unique replacement token. Browser tests
construct the expected output by replacing only that token in the original
UTF-8 byte buffer. The test also creates a BOM + CRLF variant at runtime, so
line endings and the BOM are verified without storing a platform-normalized
copy in Git.

## Current preview boundary

The edit canvas is a same-origin `srcDoc` iframe with exactly
`sandbox="allow-same-origin"`. It intentionally has no `allow-scripts` token.
PageRoot additionally rewrites executable author scripts and refresh meta tags
before assigning `srcDoc`. Native editing tests therefore run inside the edit
document, while the fixture's author scripts must remain inert. Nested frames,
canvas pixels, generated pseudo content and shadow content do not cross this
source-selection boundary and use comment-only behavior.

Tests may attach passive event recorders and query Selection from Playwright.
They must not inject editing behavior, create a mirror, or turn a fixture node
contenteditable themselves; those actions belong to the production editor.
