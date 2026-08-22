# Security model

PageRoot edits local files and renders user-controlled HTML, so its default policy is least privilege and fail-closed validation.

## Main controls

- Electron renderer sandbox, context isolation, disabled Node integration and explicit Content Security Policy
- Narrow preload APIs with payload validation instead of direct IPC exposure
- Project-path allowlisting and real-path checks for privileged file operations
- v4 Registry-bound write allowlisting: a privileged project-file write
  requires one Registry record whose `projectId`, registered root path,
  recovered root identity, `project.json`, and manifest mappings agree
- Hash-checked v4 Working Copy saves with same-directory atomic replacement
  and fail-closed external-modification checks; `/source-history/action` on a
  v4 project returns the current bytes and empty history rather than a v3
  journal
- Same-directory filename changes with a fixed HTML extension, source Hash
  precondition, no-overwrite destination check and a crash-recoverable
  operation journal
- Per-process Bridge authentication token and managed workspace boundaries
- Narrow Edit-menu IPC: the main process sends only `undo`/`redo` intent, and
  native field history exposes only Electron's fixed undo/redo commands; the
  renderer cannot submit a filesystem path or arbitrary editing command
- Per-task Agent delivery choice: the portable path remains exact clipboard
  write plus readback, while the managed path is a Bridge-owned Qoder ACP
  session. Renderer payloads contain only registered task identity and an
  opaque preflight ticket; they cannot choose a command, cwd, environment,
  prompt, Request path, Candidate path or finalizer.
- Managed Qoder starts only after explicit `trusted-local-agent-v1` consent and
  a pre-Request preflight. Opening delivery or About performs a separate
  disk-only discovery that rejects the CLI embedded in Qoder.app and accepts
  only a protected standalone `@qoder-ai/qodercli` package at the minimum
  reviewed version; it never runs Qoder, contacts Qoder, creates a Request or
  locks the Canvas. Only explicit “Qoder CLI” activation performs `--version`
  and `--list-models`, verifies executable realpath/mode/content identity and
  obtains an opaque short-lived ticket; a changed executable invalidates that
  ticket. Arbitrary command overrides are enabled only when both dedicated E2E
  environment fences are present.
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
  single-instance lock. Classification of that path is read-only until the user
  confirms. The renderer receives only `requestId` and display facts; it cannot
  submit a filesystem path, source key or trash target. Optional deletion of a
  newly imported original is a one-shot Main `shell.trashItem` after Canvas
  verification, and only when the file still hashes the same, is a regular
  non-symlink file, and lies outside the projects root. It never grants a
  renderer path or a late
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
- Ordinary static Edit may use the same contained resource root for images,
  fonts, styles and media, but not for renderer or authored scripts:
  `pageroot-preview:` is absent from `script-src` and every source transition
  revokes the previous session. After an external HTML import, Main substitutes
  the original sibling directory as that preview/edit resource root without
  exposing the original path to the renderer. The separate one-shot ECharts
  path never reuses that preview session.
- Desktop one-shot Edit author runtime is a deliberately narrow ECharts
  capability for trusted, user-opened local generative HTML, not a hostile-page
  sandbox. Main first re-reads the active source and requires exact HTML/SHA,
  bounded classic scripts, an ECharts signal and uniquely bound empty hosts; it
  freezes local or allowlisted-CDN script bytes into a one-use
  `pageroot-edit-runtime:` session. The final visible Edit iframe runs that
  closure once at real Edit size with the sandbox tokens required for in-place
  editing. Relative visual assets resolve only through the declared, contained
  asset map; direct `file:` assets and authored base URLs are blocked. The
  protocol has no `bypassCSP`, exposes no directory listing or project path,
  and the runtime document keeps `connect-src`, workers, popups and top-level
  navigation closed. A fixed bootstrap freezes timers, listeners, observers,
  animations and MessageChannel ports, then audits source fidelity; the real
  Canvas/SVG stays in that
  iframe. Same-origin `window.parent` access is a known, explicitly accepted
  product risk (ADR 0025): author scripts in that iframe can reach
  renderer-exposed contextBridge APIs on the parent. The iframe itself still
  has no Node integration and no preload or IPC sender of its own. Capture
  failure or audit rejection revokes the session and renders static Edit before
  interaction. Edit must not answer a security concern by converting to PNG.
  Remaining low-cost boundaries: no directory listing or project path on the
  edit-runtime protocol, no popup, no worker, no top-level navigation.
- Desktop Review runtime snapshot capture is one narrow IPC capability. The
  main process revalidates exact source HTML/SHA and a bounded
  source-host binding, owns one hidden sandboxed BrowserWindow with Node
  disabled, denies navigation, popups and webviews, and destroys the window plus
  preview session after each capture or superseding request. Every page-realm
  evaluation and bitmap operation is bounded by the shared owner deadline;
  authored clocks cannot keep the window alive. It returns only bounded PNG
  bytes plus validated dimensions/content SHA/byte length and a bounded
  SHA-256 of normalized visible DOM/SVG text, never raw runtime text, HTML,
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

## V4 Registry and managed-root authority

The v4 Registry is the canonical write allowlist, not a cache for locating
projects. A privileged project-file write requires one Registry record whose
`projectId`, registered root path, recovered root identity, `project.json`, and
manifest mappings agree. The root must be a direct child of the configured
projects directory, and every managed control path is real-path checked with no
symlink traversal.

The only mutable Registry compatibility path is the exact pre-hardening V4
shape with `schemaVersion: "4.0.0"`, no `pendingImports`, and no project-record
fields beyond `projectRootPath` and `updatedAt`. The migration reader validates
a current Registry read-only. Before completing that legacy shape, every record must
prove its valid key, direct-child real non-symlink root and matching
`.pageroot/project.json`; the new root identity comes only from the live
directory stat. A short-lived exclusive migration lock serializes the one
replacement across Bridge processes; dead-owner reclamation atomically claims
the exact sealed token marker, and every waiter re-reads under that lock
before it may publish. Validation finishes before the old Registry bytes are
copied to a Hash-named backup and one atomic current Registry is published. The
backup is not runtime authority. Any validation or publication failure leaves the old
Registry bytes in place and never resets, drops, scans, imports or reassociates
a Project. HTML Hashes and equal bytes never participate in this migration.

A same-parent Finder rename can update that Registry record only through a
compare-and-swap after the stable project identity and root filesystem identity
match. Moving a root elsewhere, crossing a volume, or copying it never grants
write authority: the in-memory session remains readable but writes fail closed
until the exact registered location is available and revalidated. Import
recovery is likewise limited to Registry-owned pending intents; a discovered
`.pageroot/import.json` is never proof that an arbitrary copied root is managed.
The same canonical external path binds to at most one `projectId`. Content Hash
never matches a file at another path into that project. Duplicate source-key
claims fail closed without deleting or merging projects. Ordinary Registry
mutations take a current write lock under `.pageroot-registry-write-lock/`,
which is the only Registry lock. A Registry that is not a valid current Registry
fails closed and keeps its exact bytes; there is no migration and no fallback to
an empty Registry, because an empty Registry would let the next import
atomically replace the real file.

That lock is reclaimable, never terminal. A lock whose owner marker proves a
dead local process is retired through its exact observed owner token. A lock
whose ownership cannot be resolved at all — an empty directory left by a crash
between `mkdir` and its owner write, a doubled marker left between the two
retire renames, or a damaged owner file — is crash residue rather than a held
lock, and can never become resolvable again. Such a directory is reclaimed once
it is older than a grace period, after re-proving both its filesystem identity
and its still-unresolved lease. Age is measured from creation and content
timestamps only, never from inode metadata time, so an unrelated metadata touch
cannot restore a permanently busy Registry. A live resolvable owner is never
reclaimed on age alone. Releasing that lock is cleanup and never authority: a
release that cannot complete leaves an inert directory to be reclaimed on age,
and never becomes the outcome of an operation that already committed nor replaces
the original error whose code drives recovery.

Working-copy filename changes retain their immutable IDs. A missing mapping may
be repaired only by one unique direct-child file-identity continuity clue; Hash
may validate bytes afterwards but never grants identity. An ambiguity is a
content-preserving error. Promotion may prepare a provisional relative path in
a durable transaction, but freezes the final visible path only after its
no-replace publication succeeds. Recovery re-derives every identity-bearing
transaction field and any created Working Copy from the runtime-sealed
Candidate and its managed source Working Copy; a transaction is never an
independent authority for version ordinal, lineage or path identity. A replaced
preparation file or an untrusted collision fails closed rather than deleting
user data.

The external AI Agent can write within the Request / Attempt workspace, so
those files are evidence to validate rather than runtime authority. Reopen and
crash recovery may follow only an already-sealed `runtime-state.json` Request /
Attempt / Working Copy anchor, or a registered Promotion transaction. A cleared
or missing runtime state never scans Request directories to revive an active
Request or to adopt a replacement input-manifest digest.

The packaged Qoder ACP driver narrows the protocol surface but does not change
that trust statement. One driver serves both the execution and the discussion
policy, and the branded policy `mode` — never a caller-supplied host — selects
the host, the client capabilities declared to the Agent and whether the turn
must prove completion; a host that cannot answer the required surface, such as a
read-only host in an execution turn, is refused before the turn starts. For an
execution turn it checks the runtime-sealed manifest Hash, exact current
Request layout, frozen file identities, single Candidate path and exact
official finalizer; every other ACP filesystem and terminal request is rejected.
It revalidates runtime authority before mutations and Candidate publication,
stages the output beside its destination, then atomically renames it. Prompt,
frames, updates, Agent metadata and public session history are bounded. Abort
closes the mutation surface before Qoder cancellation/process-group cleanup;
the Bridge cancels the durable Request only after that bounded stop completes.
Before spawn, an exclusive project-local lease and a final executable
dev/inode/size/mtime/content identity comparison fence duplicate launch. The
standalone npm JavaScript bundle is then loaded by PageRoot's trusted runtime
from the already-opened verified file descriptor, so a pathname replacement
cannot substitute different script bytes after that comparison. A normally
settled process releases that lease only after bounded process-group cleanup.
If the Bridge crashes, the lease remains: PageRoot never invents a
surviving session, and the processing Request becomes interrupted and
non-retryable. Durable cancellation then fences the old Request, but does not
claim an unknown old process has stopped; the user must submit a new Request.
Unknown cleanup and any unfinalized output/completion likewise block retry and
clipboard fallback instead of being overwritten.
Pre-Request version/model probes use the same bounded process-group cleanup.
An unconfirmed probe descendant creates no Request but remains a non-prunable
Bridge-level fence, so later preflight and application shutdown both fail
closed rather than forgetting an unowned local process.
Quit, relaunch and update installation also fail closed: the Bridge stays alive
and the desktop app remains open unless all owned Agent cleanup is confirmed.

A read-only discussion turn is a narrower surface on the same trust boundary.
The renderer may request `POST /discussion/start`, `GET /discussion/status` and
`POST /discussion/cancel` with registered document identity, the fixed
`qoder-acp` driver, explicit `trusted-local-agent-v1` consent and a one-use
ticket redeemed from the Agent service; it names no command and no path. The
Bridge reads the Working Copy through the Repository, refuses a stale context
Hash or a target that does not match the registered Project File, mints the turn
identifier itself, and keeps at most one in-flight turn per Document. Qoder sees
only a short-lived owner-only snapshot directory, so it cannot derive the
Working Copy path; the snapshot is deleted on every exit path and an unconfirmed
deletion fails the turn. No Request, Attempt, Candidate or Version is created,
no finalizer runs, and `activeRequest` is never touched. A timed-out or
cancelled turn is reported as interrupted with the bounded evidence that
actually arrived, never as a completed answer. In-flight discussion turns drain
on the same shutdown gate as execution sessions.

The driver may retain at most 16 KiB of raw Qoder stderr only inside the live
Bridge promise to classify authentication/capacity/process failures. It is
discarded after classification and never enters public Agent status, PageRoot
telemetry, reports or user-facing errors. Absolute Request paths necessarily
appear in the user-authorized Qoder task prompt and may therefore be processed
by Qoder; the user statement and Privacy notice disclose that third-party path.

This is an explicit trusted-local-Agent policy, not hostile-process isolation.
The Qoder subprocess still runs with the signed-in local user's OS identity and
can theoretically read or modify files without using ACP. The selection dialog
keeps only the concise task-specific disclosure that Qoder reads this turn's
HTML, comments and attachments and that results enter review; the packaged user
statement retains the complete local-permission, third-party-processing and
non-sandbox disclosure. The restricted ACP host is a cooperative
least-privilege boundary and must never be described as an OS sandbox.
Candidate completion still requires the official finalizer and Repository
validation; ACP stop/progress cannot create, adopt or activate a Version. See
ADR 0032. The synthetic live probe remains diagnostic evidence only and is not
a release gate (ADR 0031).

Installation and login guidance is copied only after the user's explicit
button action and must pass the same clipboard write/readback check as the
normal portable handoff. A local availability failure never writes the
clipboard. Neither the delivery card nor About receives or displays command
paths, npm prefixes, versions or model counts; stable error classes remain in
local diagnostics.

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
When the user returns to ordinary editing, PageRoot accepts only an allowlisted
source-backed presentation diff. It rejects unknown or duplicated source nodes,
stale Hashes, arbitrary one-sided runtime classes, text/HTML, inline style,
form state and runtime children. The desktop one-shot ECharts exception may
keep real author Canvas/SVG inside an approved empty source host after one
visible-iframe execution and freeze. It has no source or persistence authority
and is never serialized. Save, review comparison and Request creation continue
from authoritative source bytes (the Bridge copies those exact bytes to
`input/base/index.html`), and the SourcePatch checks remain unchanged.

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
container, visible Canvas/SVG paint, and hashes a bounded normalized sequence
of visible DOM/SVG text without returning the text itself. It performs one rect
pass and at most one bounded PNG capture per host. Renderer memory revalidates
PNG bytes, dimensions, hash and aggregate limits. It treats layout and the
text hash strictly; only an equal-text PNG mismatch reaches the one local mean
absolute RGB comparison, whose `0.04` budget rejects encoder/tile noise. The
owner deadline is scheduled in main, so page-controlled promises or timers
cannot extend it.

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

Install-level UI preferences (`ui-preferences.json`) are Main-owned, bounded
and atomically replaced. The renderer receives only `get`/`record` for the
first-real-HTML guide through trusted IPC; the payload is `presented` or
`dismissed`. Ordinary `PAGEROOT_E2E=1` launches do not expose that renderer
port, so automated profiles skip first-install IPC during hydration; tests
that need the real card set `PAGEROOT_E2E_FIRST_EDIT_GUIDE=1`. The file must
not contain HTML, paths, comments or credentials. A damaged or oversized file
is treated as empty pending state. The built-in welcome `projectId` is
recorded after welcome registration so that page never shows the
first-real-HTML card.
