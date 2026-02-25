# Chat History Panel

Status: Proposed  
Created: 2026-01-12  
Updated: 2026-02-24

## Summary

Add a history sidebar that supports multiple chat sessions, session switching, and persistent local history.

## Problem

Single-session chat prevents users from starting clean workflows and revisiting earlier outcomes.

## Scope

In scope:
- Create, list, switch, and persist sessions.
- Auto-title sessions from first user message.
- Slide-out panel toggle in chat header.

Out of scope:
- Cross-device sync in this phase.
- Server-side history storage.

## Requirements

- The UI MUST support creating a new session without losing prior sessions.
- The UI MUST persist session list and messages in local storage.
- The UI MUST restore the last active session on reload.
- Switching sessions MUST save current state before navigation.
- Session titles SHOULD be generated from first user message and editable later.
- The implementation MAY include a migration path for future remote storage.

## Architecture / Dataflow

1. User creates or selects a session in sidebar.
2. Session store updates `currentSessionId` and message list.
3. State is persisted to local storage after changes.
4. On app load, store hydrates sessions and restores active session.

## Edge Cases and Error States

- Corrupt local storage payload: reset to empty state with user notice.
- Missing active session id: fallback to most recently updated session.
- Session delete of active session: switch to next available session or create blank.
- Storage quota exceeded: stop writes and show non-blocking warning.

## Acceptance Criteria

- User can create 3 sessions, switch between them, and see independent message histories.
- Reload preserves sessions and active selection.
- Invalid storage payload is handled gracefully without crash.
- Session creation and switching works without network dependency.

## Task Breakdown

1. Add session model and persistence utilities.
2. Implement sidebar list and toggle.
3. Add create/switch flows and title generation.
4. Add hydration, recovery, and error handling.
5. Add integration tests for persistence and switching.
