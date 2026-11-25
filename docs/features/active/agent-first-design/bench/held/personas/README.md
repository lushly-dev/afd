# The persona cards

Drafted on 2026-11-15; frozen with the faults and the walks before the first walk. Five cards,
the panel size the owner agreed: one for each modality in the proposal's table (section 5.5),
and a second sighted pointer persona with a different stance, so that the overlap between two
reviewers of one modality is measured. Each card names a kind of user, how experienced they
are, a modality and a stance.

| Card | Modality | Stance |
| --- | --- | --- |
| [P1, the regular](p1-the-regular.md) | Sighted, pointer | Quick |
| [P2, the first morning](p2-the-first-morning.md) | Sighted, pointer | Careful |
| [P3, keys only](p3-keys-only.md) | Keyboard only | Methodical |
| [P4, by ear](p4-by-ear.md) | Screen reader | Exact |
| [P5, close up](p5-close-up.md) | Low vision | Patient |

## What enforces the modality

The card alone is not a modality. The runner exposes only these tools, through Botcore's
`cdp_*` commands, to each persona:

| Modality | Perceives | Acts with | Viewport |
| --- | --- | --- | --- |
| Sighted, pointer | A screenshot after each action | Click or double-click at a point, scroll, type text into the focused field. No other key | 1280 × 800 |
| Keyboard only | A screenshot after each key, with the focus indicator as the page draws it | Press a key or a chord, type text | 1280 × 800 |
| Screen reader | After each key, what a screen reader would speak: the node the key moved to, with its name, role, state and value and the names and roles of the landmarks, lists, tables and dialogs it is inside; and the text of any live region that changed | Press a key or a chord, type text. Tab and Shift+Tab move focus. A reading cursor moves through the accessibility tree in reading order, one node at a time with the down and up arrows, and by heading, landmark, list, table or form field with H, D, L, T and F, Shift going back; Enter or Space on the node under it activates it: the runner focuses the node's element and presses that key, never a pointer click | 1280 × 800, never shown |
| Low vision | A screenshot after each action | Click at a point, scroll, press a key or a chord, type text | 320 × 800, which is 1280 px at 400 % zoom |

No persona gets the DOM, selectors, the journal, a whole accessibility tree at once, or a tool
that finds an element by name. What the screen-reader persona is given approximates what a
screen reader speaks; capturing speech is not built (`bench.md`, "Faults, personas and
held-back jobs").

## What every persona is told

The same preamble, then the card, then the walk's script ([walks.md](../walks.md)):

> You are trying out a screen of a seed library's application, as the person described below,
> and with only the senses and hands described. Do the job you are given as that person would.
> As you go, and when you finish or give up, report what got in your way.
>
> For each thing that got in your way, give: where you were and what you were trying to do;
> what happened; what you expected; and whether you saw it happen (*observed*) or are judging
> how it would feel to a person like you (*hypothesis*). Report only what you met. Do not
> suggest fixes.
>
> When the job is done, say "Done." If you cannot finish it, say "Stopped", and why.

The persona is not told that faults were planted, how many there are, or which build it is on.
