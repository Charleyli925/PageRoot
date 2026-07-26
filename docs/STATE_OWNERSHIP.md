# State ownership

| Mutable fact | Sole owner | Durable authority | Consumers |
| --- | --- | --- | --- |
| Open source locator before first durable action | Project session | active-file record only | initial view and registration command |
| Registered project/document/source identity and session generation | Project session | project registry and `project.json` | views, all durable sessions |
| Current source bytes, Hash, edit revision and pending write | Document session | source HTML, runtime autosave record and recovery log | Canvas, drain coordinator |
| Active renderer draft revision, pending command and unknown-outcome reconciliation | Draft session | acknowledged aggregate fingerprint plus crash-only recovery outbox | comment rail, drain coordinator |
| Comments, edit events, tombstones and operation acknowledgements | Draft aggregate and Bridge draft service | `draft/annotations.json`; runtime stores only its pointer and revision | draft session, Request freeze |
| Staged comment attachments and references | Draft aggregate attachment repository | managed draft attachment directory plus draft references | composer and Request freeze |
| AI Request/Attempt/Version transition | Run lifecycle | runtime state, immutable Request/Attempt/Version records | process panel, project list |
| `PROJECT.md` content and save status | Project-rules session | managed `PROJECT.md` | project panel, Request freeze |
| Close/switch/submit/history readiness | Drain coordinator | composed owner snapshots; no separate copied state | Electron close handshake and navigation |
| Bridge transport, timeouts, error details and unknown outcomes | Typed Bridge client | no durable state | application sessions |
| Crash-only renderer recovery records | Recovery store adapter | browser storage, subordinate to Bridge authority | document and draft sessions |
| Native edit lease, IME/composition and transaction candidate | Native edit session machine | in-memory until SourcePatch acknowledgement | Canvas controller and document session |

Rules:

- A consumer never writes another owner's fields directly.
- An opened source locator is not a registered project context. Empty
  `projectId` or `documentId` values may not be used as placeholder authority.
- The first durable action atomically registers the project identity and binds
  the Draft session to the returned authoritative draft before local aggregate
  state can be acknowledged.
- Cross-owner operations are coordinated explicitly; they do not synchronize
  through incidental React effects.
- Runtime state is not a second copy of draft contents. It carries lifecycle
  state and a revisioned pointer to the draft repository.
- Local recovery records are an outbox/fallback, never an equal authority to an
  acknowledged Bridge revision.
