# ADR 0006: Usage telemetry uses random installation identity and a strict event allowlist

- Status: Accepted
- Date: 2026-07-29

## Context

Product iteration needs evidence about module use, project flows, direct edits,
faults, notifications and interruptions. A Mac serial number would remain a
stable hardware identifier, survive ordinary application reinstall decisions,
and create an unnecessary identity boundary. Renderer-owned analytics would
also let user-controlled HTML or future UI code bypass one consistent policy.

## Decision

- Packaged PageRoot builds enable product telemetry by default and disclose it
  in the first-open notice, About dialog and `PRIVACY.md`. There is no telemetry
  prompt or product setting.
- The Electron main process is the sole telemetry owner. Preload exposes one
  fire-and-forget capture intent; the main process revalidates the event against
  an exact schema before persistence or transmission.
- The installation identity is a random UUID created by PageRoot and stored in
  its Application Support state. PageRoot never reads a serial number, hardware
  UUID, device name or account identity for telemetry.
- Each application launch creates a random session UUID. Project correlation
  uses HMAC-SHA256 of the internal project ID with an installation-local random
  secret. The source project ID is never queued.
- Only enumerated properties are accepted. HTML, page text, comments, prompts,
  AI output, attachments, clipboard data, names, paths, raw exceptions and
  stacks have no schema route.
- Direct edits and successful saves are locally aggregated. Other events use a
  bounded persistent queue, batch delivery and exponential retry.
- PostHog receives anonymous capture events in US Cloud with person profiles,
  GeoIP resolution, autocapture and session replay disabled.
- The release candidate requires a configured `PAGEROOT_POSTHOG_TOKEN`. The
  project token is embedded as a public client ingestion token; no PostHog
  personal API key or project secret key is packaged.

## Consequences

Telemetry can correlate one installation and its pseudonymous projects well
enough to measure funnels and recurring failures without using hardware or
content identity. Removing PageRoot Application Support data resets that
identity.

Because delivery is best effort, network loss may delay or discard observations.
Telemetry is not an editor state owner, does not participate in any drain
obligation, and cannot block edit, save, close, project switch, submit or update
installation. The receiving network necessarily observes a source IP during
HTTPS transport even though PageRoot does not add it to event properties and
requests no GeoIP processing.
