---
name: optimistic-mutations
description: >
  Guidance for designing optimistic mutation flows in interactive AFD clients.
  Covers when optimistic updates are appropriate, how to separate visual state,
  view-state, and business data, how to reconcile command results, and how to
  pair optimistic UI with AFD features like output schemas, reasoning, warnings,
  and undo metadata. Use when building or reviewing toggles, reordering, create
  flows, autosave, or other latency-sensitive mutations in user-facing apps.
  Triggers: optimistic UI, optimistic mutation, rollback, reconcile, pending
  state, temporary ID, optimistic reorder, optimistic create, autosave.
---

# Optimistic Mutations

Use this skill for **interactive AFD clients** that need instant feedback for reversible mutations.

This is a **client pattern**, not an AFD core feature. AFD should own the command contract and reconciliation surfaces; each client should own its local pending state and rendering behavior.

## Scope

Applies to:

- browser or desktop UIs with local render state
- reversible, latency-sensitive mutations
- client flows that execute AFD commands asynchronously

Does not apply to:

- MCP or CLI-only flows
- destructive or security-critical actions
- collaborative editing conflict resolution
- generic caching or query invalidation problems

## Core Model

Split state into three layers:

| Layer | What belongs there | Backed by commands |
|---|---|---|
| Visual | hover, drag ghost, animation, focus ring | never |
| View state | panel open, active tab, selection overlays, layout | use `view-state-*` when it should be observable or automatable |
| Business data | todos, notes, order, membership, records | yes |

Rule of thumb:

- keep the UI instant
- keep business logic in commands
- keep authoritative state on the command side

## When To Use Optimistic Mutations

Good fits:

- toggle complete
- reorder list items
- create a record in a visible list
- draft autosave

Avoid optimistic mutation for:

- delete, archive, revoke, or other destructive actions
- auth and permission changes
- payment or checkout
- flows where the server commonly rejects or transforms the request

## AFD Fit

AFD is helpful here, but mostly through existing features:

- **Output schemas**: declare the response shape so clients know how to reconcile confirmed or corrected state
- **`reasoning` and `warnings`**: explain server corrections to the user
- **`undoable` / `undoCommand` / `undoArgs`**: useful after a successful mutation, not as a substitute for rollback on failure
- **View state**: keep UI chrome and layout state out of business mutation flows

If you need implementation details for these pieces, also load:

- `afd-developer` for CommandResult and error conventions
- `afd-directclient` for client execution patterns

## Standard Flow

1. Capture enough local state to recover.
2. Apply the optimistic UI update immediately.
3. Mark the entity or view model as pending.
4. Execute the AFD command.
5. On success, replace optimistic state with authoritative state from the result.
6. On failure, rollback or refetch authoritative data.
7. Clear pending markers and surface a human-readable message.

## Reconciliation Rules

Use these rules consistently:

- The server result is authoritative.
- If the command returns corrected state, prefer that over the optimistic guess.
- If exact rollback is hard, refetch instead of leaving mixed state in place.
- Track in-flight mutations per entity so older responses do not overwrite newer optimistic state.

For overlapping mutations, store a client-side `operationId` or equivalent pending token and ignore stale responses that no longer match the latest local operation.

## Command Design Guidance

Optimistic clients work better when commands return enough information to reconcile:

- confirmed entity after create or update
- corrected order after reorder
- normalized values after validation or policy adjustments
- `reasoning` when server behavior differs from the request
- actionable `error.suggestion` on failure

Prefer command outputs like:

- `todo-toggle` -> updated todo
- `list-reorder` -> confirmed or corrected order
- `item-create` -> created entity with canonical ID

## Client Guidance

Keep these behaviors local to each client:

- pending row/card styling
- temporary ID strategy
- toast vs inline error presentation
- retry UX
- drag and drop visuals

Those details are usually too product-specific to centralize in AFD.

## Checklist

- [ ] Action is reversible and low-risk
- [ ] UI-only state is not mixed with business data
- [ ] Command output is sufficient for reconciliation
- [ ] Failure path rolls back or refetches
- [ ] Stale responses cannot overwrite newer local state
- [ ] Errors shown to the user are actionable
- [ ] The command is still correct when called without optimistic UI

## Anti-Patterns

- Optimistically mutating destructive actions
- Treating `undoable` as the same thing as rollback
- Leaving optimistic placeholder data in shared domain models indefinitely
- Hiding server corrections instead of surfacing them
- Putting view-state concerns inside business mutation commands

## Escalate When

Pause and reconsider the design if:

- two or more clients want the same optimistic helper abstraction
- the server frequently returns corrected state
- multiple surfaces mutate the same entity concurrently
- the flow really needs revisions, etags, or conflict detection

At that point, the shared value may be a small AFD reconciliation contract, not a bigger optimistic UI framework.
