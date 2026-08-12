# Security model

PageRoot edits local files and renders user-controlled HTML, so its default policy is least privilege and fail-closed validation.

## Main controls

- Electron renderer sandbox, context isolation, disabled Node integration and explicit Content Security Policy
- Narrow preload APIs with payload validation instead of direct IPC exposure
- Project-path allowlisting and real-path checks for privileged file operations
- Registry-bound readable project-directory validation; names are one safe path
  segment and must carry the short token of their internal `projectId`
- One hash-checked Bridge SourceTransaction kernel for autosave and source
  history, with same-directory atomic replacement, durable recovery bytes,
  pending-write/audit replay and fail-closed external-modification checks
- Bounded source-history writes that accept only the actual forward and inverse
  SourcePatch ranges, verify the complete before/after Hash chain, and reject a
  stale cursor, reused action identity or inconsistent replay ledger
- Same-directory filename changes with a fixed HTML extension, source Hash
  precondition, no-overwrite destination check and a crash-recoverable
  operation journal
- Per-process Bridge authentication token and managed workspace boundaries
- Narrow Edit-menu IPC: the main process sends only `undo`/`redo` intent, and
  native field history exposes only Electron's fixed undo/redo commands; the
  renderer cannot submit a filesystem path or arbitrary editing command
- Clipboard-only third-party AI handoff
- Fixed app-resource lookup for the packaged user statement and disclaimer;
  the renderer can request it but cannot choose a local path
- Default-browser opening accepts only an already known HTML source path,
  revalidates that file in the main process, and converts it there to a local
  file URL; the renderer cannot supply an arbitrary URL or protocol
- External OS/QoderWork opening accepts only a validated absolute `.html` or
  `.htm` path behind a main-process-created opaque request ID. The renderer may
  consume that ID once but cannot substitute a path; stale IDs are rejected,
  and the main-process project-open queue serializes its validation, reading
  and active-project mutation with every other active/recent-project transition
  so an older request cannot overwrite the newer active source. An external
  delivery interrupts an uncommitted close; after close commits it is stored
  only as the latest validated path in a private one-shot handoff, then passes
  the same mailbox validation again only after the next launch owns the
  single-instance lock. It never grants a renderer path or a late
  active-project mutation.
- Desktop interactive preview runs under a dedicated `pageroot-preview:`
  origin. Its main-process session is size/count/time bounded, exposes no
  PageRoot preload bridge, and serves only a session-specific allowlist of
  declared relative script, style, image, font and media assets after source
  path authority, realpath and containment checks. Dotfiles, undeclared
  siblings and files reachable only through an escaping symlink are never
  exposed. The document response blocks `file:` resource loading and authored
  base URLs. The application renderer's CSP remains strict and the preview
  scheme does not receive `bypassCSP`.
- The edit iframe may use the same session root for images, fonts, styles and
  media, but not for renderer or authored scripts: `pageroot-preview:` is absent
  from `script-src`, the edit document remains sandboxed without script
  capability, and every source transition revokes the previous session.
- Desktop Review runtime snapshot capture is one narrow IPC capability. The
  main process revalidates exact source HTML/SHA and a bounded
  source-host binding, owns one hidden sandboxed BrowserWindow with Node
  disabled, denies navigation, popups and webviews, and destroys the window plus
  preview session after each capture or superseding request. Every page-realm
  evaluation and bitmap operation is bounded by the shared owner deadline;
  authored clocks cannot keep the window alive. It returns only bounded PNG
  bytes plus validated dimensions/content SHA/byte length, never runtime HTML,
  SVG, script state, TargetRefs or filesystem data.
- Strict schemas, frozen inputs and identity/Hash/path checks before accepting
  AI output; complete-document and non-empty-body checks remain protocol
  boundaries. Authored scripts, handlers, executable URLs and refresh directives
  are candidate content and are not inspected, classified or surfaced during
  acceptance; existing sandboxes contain execution separately. Weak page
  continuity forces isolated review instead of silently opening or falsely
  rejecting the candidate.
- The history-only decoder accepts both August 2026 Developer Preview
  candidate-assessment shapes after regular-file and four-Hash verification,
  re-runs only current document-health and continuity checks, and strips any
  retired executable fields or conclusions in memory. It never rewrites
  history or participates in source writes; archived outcomes stay terminal.
- Review-before-open reads only the frozen current HTML and immutable candidate
  Version after rechecking their identities and Hashes. Both copies render in
  unique-origin sandboxed frames; authored scripts, refresh directives and
  inline handlers are removed, nested frames are re-sandboxed, and links/forms
  cannot navigate or submit. On desktop, each sanitized copy uses a bounded
  `pageroot-preview:` session so the exact review bootstrap loads as an external
  script without weakening the application renderer CSP; the root sandbox still
  grants only scripts. Only that review scroll/focus bridge may execute, and its
  messages are bound to the exact frame and review session.
- Main-process-only usage telemetry with exact event/property allowlists,
  random installation/session UUIDs and HMAC project pseudonyms; no hardware
  identifier, content, path, filename, raw exception or stack is accepted
- No silent application update or binary replacement

## V2 editable-island trust boundary

The rendered preview DOM is disposable and never becomes a whole-document
persistence source. PageRoot 0.9.0 has one controlled `contenteditable="true"`
route:

- SourceIndex and TargetResolver must prove one exact, explicit-end-tag HTML
  element before activation.
- Runtime layout, text style, Selection, focus and restoration must pass the
  live preflight.
- The controller prevents ordinary `beforeinput` mutations and applies owned
  text, grapheme deletion, `<br>`, plain-text paste and safe inline formatting.
  Browser-created rich HTML has no authority.
- Authored comments and embedded/foreign content are immutable inventory;
  protected attributes cannot be introduced or changed through text editing.
- IME starts from a frozen island and logical Selection. Confirmation is
  replayed once at that frozen source affinity; cancellation restores the
  snapshot.
- MutationObserver rejects and restores any child/text mutation not owned by
  the controller.
- SourcePatch may replace only the selected element's exact content range or,
  for a uniquely mapped direct text node under an unsafe mixed parent, that
  text node's exact source range. The direct-text operation also carries the
  exact surviving parent TargetRef so deletion remains invertible. Outside
  bytes and source Hash preconditions remain exact; only the authorized island
  or plain-text fragment may be minimally normalized and reparsed.
- Canvas undo/redo never serializes that preview DOM. The Bridge applies only a
  retained exact inverse/forward Patch after matching project/document
  identity, source Hash, history revision and cursor. Source HTML and the
  bounded journal share one crash-recoverable pending-write boundary; an
  external write or broken chain establishes a fresh boundary or fails closed.
  Reusing the mounted iframe is allowed only when exact target identity,
  byte-equal island-external source and the complete ephemeral source-node map
  all validate against those Bridge-returned bytes; otherwise the Canvas loads
  a fresh verified frame.

Pure-browser preview is a different, strictly weaker capability: authored scripts and interactions may run inside the sandbox, but PageRoot editing, comments, attachments, local persistence and AI submission are unavailable. Its transient page state is never treated as unsaved PageRoot content.

Desktop preview is likewise untrusted authored content. The iframe has no
top-navigation authority, new windows are denied, and preview IPC is available
only to the trusted application main frame. A direct preview frame that tries
to self-navigate is fenced by the main process; before its first load completes,
its volatile session becomes a one-way scriptless fallback retaining only the
owned external bootstrap, while later attempts leave the loaded page intact.
When the user returns to editing, PageRoot accepts only an allowlisted
source-backed presentation diff. It rejects unknown or duplicated source nodes,
stale Hashes, arbitrary one-sided runtime classes, text/HTML, inline style,
form state and runtime children. Edit never displays a captured PNG or creates
runtime projection attributes: it is a normal script-disabled source surface.
Save, review comparison and Request creation continue from authoritative source
bytes (the Bridge copies those exact bytes to `input/base/index.html`), and the
SourcePatch checks remain unchanged.

ADR 0020 defines a staged declarative exception without weakening that script
boundary. PR-1 has no production caller: it only accepts a closed, versioned
JSON Chart Spec, maps it to fixed PageRoot-owned ECharts options, renders at
declared dimensions and rejects SVG outside a closed element/reference budget.
It never evaluates authored ECharts, raw options, functions, URLs or runtime
DOM. Any future Edit integration must keep generated SVG inside a source-empty
host's disposable Shadow DOM, pointer-transparent and absent from SourceIndex,
TargetRef, SourcePatch, persistence, Review, Version and AI input.

The AI review workspace is an isolated interactive review preview with no
activation or persistence authority. It preserves the identity/Hash-validated authored
scripts and inline events in a disposable review copy so source-backed Tabs,
disclosures and local controls can be inspected. The review iframe uses only
`allow-scripts`: it has no same-origin authority, form submission, top navigation,
popup, download, modal or host IPC capability. Parent-side capture also blocks
anchor navigation and form submission, nested iframes receive an empty sandbox,
and refresh/CSP meta directives are removed only from the disposable review copy
so they cannot navigate the frame or suppress the trusted review bootstrap.
Runtime-chart evidence is enabled only through the managed desktop owner.
The authored review iframe remains presentation-only: it has no runtime capture
request, screenshot result or host capability. A parser-blocking managed
bootstrap may hold exact-element runtime bindings and one private projection
`MessagePort` in closure. The port is a separate namespace and lifecycle from
the before-only comment port, is transferred only after a random challenge is
consumed by the earliest capture listener, and accepts only the current contract
version, session, side and full source SHA. It carries `{candidateKey, changeId}`
facts, never PNGs or TargetRefs. Candidate keys/bindings are absent from authored
HTML, DOM attributes, ordinary window messages and later bootstrap fetches.
For every capture, Electron main creates a fresh non-persistent partition and
hidden sandboxed window that can load only its expected `pageroot-preview:` URL.
Permissions, navigation, popups, downloads, webviews and all non-preview
network requests are denied. The authored page receives no source path, Bridge,
preload, Node or filesystem capability; when an active desktop document needs
relative assets, main supplies only its declared, contained source-relative
allowlist to the ephemeral preview. Inline/browser review remains static-only.

Entering review does not change `project.json.sourcePath`, the current Canvas,
the immutable Version or the activation transaction, and runtime interaction
state is never serialized. The renderer accepts a snapshot result only when its
envelope matches contract version, capture session, side and full source SHA.
Candidates come only from the frozen `SourceHostResolver`: direct Canvas/SVG
roots or source-empty stable hosts. TargetRefs remain in trusted renderer
memory. The first private bootstrap response alone contains a path plus complete
narrow fingerprint for each accepted exact host; the managed preview consumes
that response once and serves an unbound fallback thereafter. An omitted,
malformed, late or failed owner result leaves static Review authoritative.

Before scripts run, the owner validates the source path/tag/identity. Its
isolated-world program then confirms that same runtime host and, for a stable
container, visible Canvas/SVG paint. It performs one rect pass and at most one
bounded PNG capture per host. Renderer memory revalidates PNG bytes, dimensions,
hash and aggregate limits. The owner deadline is scheduled in main, so
page-controlled promises or timers cannot extend it.

Runtime projection never queries an outline for geometry and never writes a
runtime marker or fact attribute to the source DOM. The bootstrap retains the
original bound `Element` and a disposable `Map<Element, facts[]>`; a replaced,
disconnected or fingerprint-drifted target contributes no runtime rectangle.
Static facts remain independently complete and are not removed by empty,
invalid or failed runtime delivery.

Comment location remains separately private. Each source-resolved local target
may use an opaque initial-bootstrap binding: an element path plus a narrow
static fingerprint, never a source-node identity in authored HTML. The managed
preview serves that binding only to the first parser-blocking bootstrap request,
then falls back to an unbound response. The trusted parent sends the final
key-to-target mapping only to the before bootstrap over a challenged private
`MessageChannel`. Comment body, key, source-node and locator-map data are absent
from document bytes and later bootstrap reads. A unique source `id`, `data-*`,
`name`, or `aria-label` is only a safe fallback; missing, ambiguous, replaced or
disconnected targets omit the comment marker rather than rebinding by guess.
This capability cannot discover or authorize runtime snapshots. Capture results
are compared once; no replay/confirmation pair, script analysis or
comment-group discovery exists. Navigation, cancellation, timeout, invalid PNG or
cleanup failure destroys the window and revokes the ephemeral session. The user
still invokes the existing fail-closed ready-version activation path through
“直接打开” or the review confirmation “打开 AI 修改后”.

Edit-mode reveal actions use the same trust boundary. They accept only strict
Tabs whose selected panel is proved by `aria-selected` plus `hidden`, native
details with one direct summary, and local button/region disclosures whose
`aria-controls`, `aria-labelledby`, `aria-expanded` and `hidden` states agree.
The only legacy Tab adapter accepts sibling `button`/`div` controls with one
uniform `data-p` or `data-tab` attribute, a unique one-to-one panel-ID mapping,
uniform base classes, and exactly one matching `active` control/panel pair. It
can transfer only that `active` class. A second bounded legacy adapter accepts
only sibling `button`/`div`/`li` controls whose inline handler is exactly the
same identifier called with consecutive constant decimal indices, plus one
uniquely related, equal-length panel group with uniform base classes and one
matching active pair. The handler string is structural evidence only and is
never evaluated. Duplicate mappings or indices, mixed identifiers, gaps,
dynamic or multi-statement handlers, multiple candidate panel groups,
multi-active state, and unsupported class-only inference all fail closed.
Links, forms, grouped details, popups, popovers, drawers and authored event
handlers are never executed. The action changes disposable attributes only and
has no source-write, filesystem, navigation or implicit scroll authority.

## Untrusted inputs

HTML, attachments, AI output, update manifests and IPC payloads are treated as untrusted. Tests and fixtures must use synthetic data. A renderer compromise should not provide arbitrary Node or filesystem access; any new privileged API needs explicit validation and negative tests.

The default-browser HTML action first drains the exact renderer edit revision
to the authoritative source file. Its main-process operation accepts only an
authorized main-frame sender and a known ordinary `.html` or `.htm` project
path, then derives the `file:` URL itself. Executable negative tests prove
malformed, non-HTML, unknown, unsafe and unauthorized requests cannot reach
the shell launch adapter.

Close reconciliation never writes from a preview or from stale metadata. It
hashes the frozen authoritative renderer bytes, fences the current project
identity, and uses a bounded read-only `/source` query only when acknowledged
local state is insufficient. The response must match the captured registered
identity and its declared Hash must match independently hashed content before
it can repair the renderer projection. Any real byte divergence remains
fail-closed and preserves both the in-memory editor copy and the disk copy.

The telemetry preload method is fire-and-forget and does not expose a generic
network API. The main process verifies the sender frame and independently
sanitizes the event through a closed schema. Persistent telemetry state is
bounded, atomically replaced and private to the user. PostHog capture disables
person-profile processing and GeoIP resolution; autocapture and session replay
are not installed. HTTPS transport still exposes the source IP to receiving
network infrastructure, so product copy must not claim absolute anonymity.

## Distribution and update trust

Public macOS candidates fail closed unless they are signed by the expected Developer ID team, use Hardened Runtime, pass Apple notarization, carry a stapled ticket, and embed the reviewed stable GitHub `app-update.yml` before signing. The candidate gate validates the exact provider, owner, repository, release type and updater-cache contract; includes those bytes in the signed-App checkpoint; and verifies the signature, Team ID, Gatekeeper assessment, DMG, update ZIP, blockmap, update metadata and frozen hashes before publication.

The main-process update controller accepts only the stable GitHub Release channel, owns both the startup-plus-four-hour schedule and coalesced manual checks, downloads the hash-described ZIP only after an explicit renderer intent, keeps differential transfer enabled, and disables install-on-ordinary-quit. The renderer receives only a bounded immutable status snapshot and narrow check/download/install intents. The About entry opens only the main-process constant for the project repository; renderer input can never choose an external URL. The same surface opens the user statement and disclaimer only from its fixed signed-app resource path and accepts neither renderer paths nor URLs. A downloaded update can install only after a second explicit restart confirmation and the normal renderer/Bridge drain succeeds; update metadata never gains filesystem or editor authority.

The current application contains no legacy manifest parser, fetch client, or
version decision path. Clients from the earlier ad-hoc update era cannot
securely self-bootstrap into this trust chain; they must manually install a
signed and notarized migration release once. Formal 0.9.8 also lacks the
embedded provider configuration and therefore requires one manual install of a
patched signed release before automatic updates can resume. The legacy
`update-manifest.json` remains a Release-produced compatibility artifact only,
so already-published clients can find that migration release without restoring
the retired client code to the current application.
