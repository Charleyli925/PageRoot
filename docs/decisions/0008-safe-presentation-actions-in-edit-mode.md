# ADR 0008: Edit mode exposes only source-backed presentation actions

- Status: Accepted
- Date: 2026-07-31

## Context

The source-authored editing Canvas deliberately blocks links, forms and
authored event handlers. That protects navigation, source identity and the
editable-island model, but it also prevents users from revealing static content
that already exists in the same HTML behind a Tab or disclosure.

Making a second click run the authored control would conflict with browser
double-click detection and could execute arbitrary page logic. Adding another
browse mode, right-click menu or hidden runtime preview would add state and
lifecycle complexity.

## Decision

- Single-click remains selection and double-click remains text-edit
  activation. The existing two-mode Edit/Preview model does not change.
- A selected eligible control gets one visible contextual toolbar action.
  `Option + click` is a shortcut for that same action. Its shortcut hint appears
  only when the toolbar action is hovered; it is not persistent toolbar copy.
- One pure resolver accepts only strict source-backed Tab/tabpanel groups,
  native details with one direct summary, and local button/region disclosures
  with internally consistent ARIA and hidden state.
- One Canvas executor sends the proposed `PageViewContext` to the Workbench
  owner and applies it only when the current document key accepts it.
- Links, forms, author handlers, class-only widgets, grouped details, dialogs,
  popovers and drawers remain inert in edit mode. Preview remains the place to
  run the actual page.
- Presentation actions never call SourcePatch or `onChange`, never serialize
  runtime DOM and never acquire save, close, project or filesystem authority.

## Consequences

Users can reveal additional editable source content without leaving edit mode,
while normal selection and double-click editing keep their existing gestures.
The toolbar remains self-explanatory, with the shortcut discoverable on hover
and no persistent instruction text.

Some visually tab-like or script-driven controls will not be recognized. That
is an intentional fail-closed boundary: authors can use standard semantic
markup for direct reveal, or users can switch to isolated Preview for the full
runtime behavior.
