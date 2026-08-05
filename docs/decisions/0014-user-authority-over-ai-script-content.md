# ADR 0014: AI candidate acceptance does not classify authored script content

- Status: Accepted
- Date: 2026-08-05

## Context

PageRoot previously compared every authored `<script>`, inline handler,
`javascript:` URL and refresh directive between the frozen base and AI output.
Any byte change blocked Version creation as `EXECUTABLE_CONTENT_CHANGED`.

That rule treated content policy as file-integrity policy. Legitimate visual
changes frequently live in executable configuration—for example ECharts color
arrays—so a correct returned document could complete every identity, Hash,
path and protocol check yet be reported as unusable. It also prevented users
from intentionally asking the AI to change page behavior.

PageRoot already separates candidate acceptance from execution authority. Edit
is script-disabled, interactive preview has no PageRoot preload authority, and
review runs in a unique-origin sandbox without host IPC or persistence
authority. The host boundary can therefore remain strict without judging the
meaning of authored code.

## Decision

- Candidate acceptance continues to validate Request/Attempt/Version identity,
  frozen and returned Hashes, managed paths, sealed records, complete HTML,
  displayable body content and transaction integrity.
- Authored scripts, script attributes, inline handlers, executable URLs and
  refresh directives are ordinary candidate bytes. The candidate assessor does
  not compare, classify, record or surface their changes.
- Script changes do not create an `attention` state, warning, badge or terminal
  error. Page continuity remains an independent coarse review signal.
- Existing `candidate-assessment.v1` records may contain the retired
  `executable` and `health.executableSurfaceUnchanged` fields. The schema accepts
  them only for read compatibility; readers normalize them out, and current
  producers and Renderer decoders omit them.
- Page execution remains contained by the existing Electron, preview, edit and
  review sandboxes. This containment protects PageRoot authority and is not a
  judgment about whether the user's HTML code is desirable.

## Consequences

AI results that add or modify code can create immutable Versions after the same
identity, Hash, path and protocol checks as other HTML changes. Users retain
authority over what their document contains, and PageRoot no longer describes
valid executable edits as unusable. Tests prove both the absence of executable
assessment fields and successful Version creation for script and inline-handler
changes. Host IPC, local project paths and persistence remain unavailable to
authored page code outside their existing narrow adapters.
