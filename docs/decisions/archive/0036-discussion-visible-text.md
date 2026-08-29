# ADR 0036: A discussion turn may show bounded visible Agent text, and that text never carries authority

- Status: Superseded by [the Discussion product retirement](../../AI_CONVERSATION_WORKSPACE_PRD.md) on 2026-08-26
- Date: 2026-08-22
- Supersedes: the Agent-output clause of ADR 0032 for discussion turns only

## Context

ADR 0032 built the managed Qoder ACP path around one rule: Agent output is
evidence, not authority. Nothing the Agent says can create a Candidate; only the
official finalizer writing the single Candidate path and PageRoot's own
validation can. To keep that boundary narrow, the driver reduced every ACP
session update to a bounded summary — update type, tool kind, status — and
dropped the text entirely. Public Agent status carries counts and phases, never
prose.

That was right for execution turns, where the product's payload is a file. It
makes a discussion turn useless. A discussion turn's entire payload *is* prose:
the user asks about the page they are looking at, and the answer is text. With
ADR 0032's reduction in place, PageRoot can run a discussion turn, prove it was
read-only, delete its snapshot — and then show the user nothing. A feature whose
result is invisible is not a feature.

So discussion needs Agent text to reach the user. The question is how much of the
0032 boundary that costs, because "let the model's words through" is exactly the
kind of decision that quietly turns evidence into authority.

Three distinct risks:

1. **Authority creep.** If the reply is rendered next to the page it discusses,
   a reply claiming "I have updated the heading" reads like a product state
   change. Nothing changed; the Working Copy is untouched.
2. **Unbounded and unsanitised content.** A hostile or broken Agent can emit
   megabytes, control characters, or terminal escape sequences. The existing
   ACP surface is bounded everywhere else precisely so one bad round cannot
   exhaust memory or corrupt a record.
3. **Hidden reasoning.** ACP distinguishes `agent_message_chunk` (what the Agent
   says) from `agent_thought_chunk` (how it got there). Storing reasoning traces
   in a durable conversation record would persist the model's internal state as
   if it were product content, and would grow the record without bound.

## Decision

A discussion turn may pass visible Agent text through to the user, under these
limits. An execution turn's behaviour is unchanged: it still reduces every update
to a bounded summary and passes no prose.

- Only `agent_message_chunk` updates with `content.type === "text"` are
  captured. `agent_thought_chunk` and every other update type are dropped, so
  hidden reasoning never reaches the renderer or a durable record.
- The captured text is bounded by a fixed byte budget inside the driver. Once the
  budget is reached, further text is discarded and the reply is marked truncated.
  A truncated reply is presented as truncated, never silently clipped.
- Control characters are removed on capture. Only ordinary text, tabs and
  newlines survive, so no record or view can receive an escape sequence.
- The text carries no authority whatsoever. It cannot create, name, adopt or
  activate a Request, Candidate or Version, and cannot move the Working Copy. A
  discussion turn still creates none of those. If a reply claims it changed the
  page, the page is the counter-evidence: PageRoot shows the unchanged bytes.
- The reply is stored only by sealing its conversation Turn. Sealing is already
  the single write path for messages, so a partial stream lives in Bridge memory
  and a stored record never contains half a message. A turn that timed out or was
  cancelled seals as `interrupted` with the text that actually arrived, and the
  interruption is visible next to it.
- The user's own question is persisted before the Agent is started. If that write
  fails, no turn is started at all.

## Consequences

- A discussion turn now has a visible result, which is the point of the feature.
- The 0032 authority rule survives intact where it matters: prose is readable and
  quotable, and is still incapable of changing product state. The reduction that
  0032 applied to *execution* updates is unchanged.
- Every stored reply is bounded, sanitised, attributed to a sealed Turn, and
  marked when truncated or interrupted. Conversation records therefore stay
  bounded and cannot accumulate reasoning traces.
- The renderer gains no new trust: it displays a stored conversation message
  through the existing read-only message stream, which already refuses any
  message carrying interface members.
- A future non-discussion use of Agent prose is not authorised by this ADR. It
  would need its own decision, because the reasoning here rests on a discussion
  turn having no output file and no Candidate to confuse the text with.
