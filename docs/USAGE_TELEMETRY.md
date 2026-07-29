# Usage telemetry operations

## Destination and release configuration

Packaged PageRoot builds send batches to the PostHog host embedded at packaging
time. The current production region is US Cloud:

```text
https://us.i.posthog.com/batch/
```

Configure the repository Actions secret `PAGEROOT_POSTHOG_TOKEN` with the
PostHog **Project token** beginning with `phc_`. Never use a personal API key or
Project secret API key. `Release Candidate` refuses to package when the token
is absent, writes a generated `usage-telemetry-config.json`, and verifies the
same file inside the App bundle.

Local development, automated tests and E2E runs do not send telemetry. Unit
tests inject a synthetic token and fake network implementation.

## Event catalog

PostHog receives the following names. All events also carry
`telemetry_schema`, `app_version`, `app_platform`, `app_architecture`, a random
`distinct_id`, a per-launch `$session_id`, and optionally an HMAC-derived
`project_key`.

| Event | Purpose | Main properties |
| --- | --- | --- |
| `pageroot app launched` | Active installations and launches | `launch_reason` |
| `pageroot app session ended` | Completed session duration | `reason`, `duration_bucket` |
| `pageroot project context opened` | Registered vs preview-only project use | `registered`, `view_mode` |
| `pageroot module viewed` | Feature adoption | `module` |
| `pageroot direct edit batch` | Aggregated direct editing | `edit_kind`, `property_group`, `edit_count` |
| `pageroot source save batch` | Aggregated successful writes | `save_count` |
| `pageroot source persistence changed` | Save failure or conflict | `from_state`, `to_state` |
| `pageroot comment saved` | Comment workflow use without content | `target_level`, `has_text`, `attachment_count`, `has_image`, `has_file` |
| `pageroot ai run state changed` | AI handoff funnel | `from_state`, `to_state`, `comment_count`, `edit_count` |
| `pageroot operation finished` | Desktop operation reliability | `operation`, `result`, `error_code`, `duration_bucket` |
| `pageroot notification presented` | Reminder volume and cause | `notice_code`, `tone`, `disposition`, `surface`, `has_action` |
| `pageroot notification interacted` | Reminder action/dismiss behavior | `notice_code`, `interaction`, `surface` |
| `pageroot interruption changed` | User-flow interruption and recovery | `interruption_code`, `phase`, `result`, `surface` |
| `pageroot renderer fault` | UI failures grouped locally | `kind`, `fingerprint`, `fatal` |
| `pageroot runtime fault` | Main/Bridge/renderer runtime health | `process`, `kind`, `reason_code`, `fingerprint`, `exit_code` |

Exact enum values and acceptance rules live in
`desktop/usage-telemetry.mjs`. Adding a field requires updating the strict
schema, privacy negative tests, this catalog, `PRIVACY.md`, and the product
notice when the user-facing boundary changes.

## First dashboards

Create these PostHog insights after the first production events arrive:

1. **Adoption:** weekly unique `distinct_id` for `app launched`, then module
   views split by `module`.
2. **Core editing funnel:** `project context opened` → `direct edit batch` →
   `source save batch`, grouped by `app_version`.
3. **AI funnel:** transitions into `submitting`, `processing`,
   `ready-to-open`, `complete`, `no-change`, `cancelled` and `error`.
4. **Reminder burden:** `notification presented` split by `notice_code` and
   `disposition`, compared with action/dismiss/auto-dismiss.
5. **Interruption burden:** started vs resolved events by
   `interruption_code`, `result` and version.
6. **Reliability:** failed `operation finished`, source `failed/conflict`,
   renderer faults and runtime faults, all split by `app_version`.

Use trends and funnels rather than person profiles. Events explicitly set
`$process_person_profile: false`, `$geoip_disable: true` and `$is_server:
false`; autocapture and session replay are not installed.

## Operational checks

After installing a telemetry-enabled candidate:

1. Open PostHog’s live events view and filter event names beginning with
   `pageroot`.
2. Open About PageRoot, switch Canvas modes, perform one direct edit, allow it
   to save, and trigger one safe notification test path.
3. Confirm only enum/code/count fields appear. Search the event payload for the
   test HTML text, filename, path and comment text; each must be absent.
4. Confirm one installation keeps the same `distinct_id` across relaunch while
   `$session_id` changes.
5. Disconnect the network, generate events, reconnect and verify queued events
   arrive without affecting edit or close behavior.

The queue is best effort and capped at 500 events. It is a product signal, not
an audit log or source of editor truth.
