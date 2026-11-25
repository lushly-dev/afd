# The checks on a build

Frozen on 2026-11-15, before any run and before any pattern statement exists. They are written
from each screen's task and results alone, so that arm 2 is not scored on rules written from
arm 0's faults. The bench specification lists the five kinds
(`bench.md`, "Scoring"). This file says how each is run and matched, and one file a screen
holds the checks themselves:
[`t1-lend-a-packet.json`](t1-lend-a-packet.json), [`t2-take-in-a-donation.json`](t2-take-in-a-donation.json),
[`t3-a-variety.json`](t3-a-variety.json) and [`t4-the-stewards-requests.json`](t4-the-stewards-requests.json).

## What a check is

Each line below is one check, and a run's share for step 0.2's rule is the checks it passed over
the checks of its screen. A story that is missing, or that fails to mount, fails every check of
its state.

| Kind | Id | Passes when |
| --- | --- | --- |
| Mount | `<state>.mount` | The story named after the state renders through Specimen, and the page logs no console error and throws no uncaught error from the start of the render to the end of the accessibility check |
| Busy | `<state>.busy` | A state that is loading or under way: `loading` on T1, T3 and T4, and `importing` on T2. Some element has the role `progressbar` or `aria-busy="true"`, or the text matches `loading`, `fetching` or `on (its\|the) way` |
| Field | `<state>.field.<n>` | The field's matcher holds on the story's text (below) |
| Control | `<state>.control.<n>` | Some element in the story is an operable control that the entry describes (below) |
| Focus | `<state>.focus` | A confirmation state only. After the story has mounted and settled, the focused element, followed through open shadow roots, is inside an element with the role `dialog` or `alertdialog` whose text holds the prompt's first sentence, or is itself the control of that state's "Confirm" or "Not go ahead" entry |
| Accessibility | `<state>.a11y` | Specimen's accessibility check, axe 4.14.0 run once the story has settled (`settledAccessibility: true`), reports no violation. A story that turns the check off fails this check |

A focus check covers only the two confirmations. A story mounts a state without the action that
led to it, so where focus goes after an action is left to the walks of steps 0.3 and 0.4.

## The story's text

A field is matched against one string per story. It is the text content of the mounted story
in the order of the flattened tree: a shadow root's content in place of its host, and slotted
nodes at their slot. `script`, `style` and `template` elements are left out. It is followed
by, in the same order of elements:

- the value of every form control;
- the accessible name of every element with no text anywhere in its subtree, such as an icon
  button or an image, from Chromium's accessibility tree;
- every accessible description, from the same tree.

Whitespace runs become one space, and matching ignores case.

The text includes content that is in the page but not shown, such as the body of a closed
disclosure. A field reaches the screen if a person can reach it from the state's story; whether
it is easy to see is for the owner's blind judgement and the walks, not for these checks.

The runner renders every story with `TZ=UTC` and the locale `en-US`, so that dates and
numbers are formatted the same way in every run.

## Matchers

A field holds a list in `any`, and passes when one of its matchers holds.

| Matcher | Holds when |
| --- | --- |
| `{ "text": "s" }` | The string contains `s` |
| `{ "pattern": "re" }` | The string matches the regular expression `re`, ignoring case |
| `{ "number": n }` | A number token (below) equals `n` |
| `{ "percent": p }` | A number token equal to `100p`, rounded to the nearest whole number, is followed by `%`, ` %`, ` per cent` or ` percent`; or a number token equals `p` |
| `{ "date": "iso" }` | The day and month of `iso`, in UTC, appear in one of the forms below |
| `{ "any": [ ... ] }` | One matcher in the list holds |
| `{ "all": [ ... ] }` | Every matcher in the list holds |
| `{ "not": { ... } }` | The matcher inside does not hold. A `not` is used only inside an `all` with a matcher that must hold, so that an empty story cannot pass it |

**Number tokens.** A token is a longest run of digits together with any `.`, `/`, `-`, `:`
or `,` that has a digit on both sides. A token is a number only when:

- no letter, digit, `-` or `_` touches either end, so the 2 in `don-2` or `req-2` is not one;
- it holds no `/`, `-` or `:`, and at most one `.`, so `2029-04-14`, `3/9/2030` and
  `10:00` are not numbers.

A comma between groups of three digits is dropped, and the token is then read as a decimal and
compared by value: `014` equals 14, `0.90` equals 0.9, and `0.35` does not equal 0.3.

**Dates.** A date matches in any of these forms:

- `2030-03-10`, with the year;
- the day and the month's name, in either order, with or without `of` between them; the name
  in full or in three letters; the day with or without `st`, `nd`, `rd` or `th`; the year
  after them or left out. No digit may touch the day, so `3 Mar` is not found in `13 Mar`;
- `10/3/2030`, `3/10/2030` or `10.3.2030`, with or without leading zeros, with a four- or
  two-figure year, as one whole token. A numeric date without its year does not match.

A relative date, such as "tomorrow", does not match.

**`with`.** A `text`, `pattern`, `number`, `percent` or `date` matcher may add
`"with": "s"`. It then holds only inside one element whose own string contains `s` as well.
That string is worked out as above for the element and its descendants, without descriptions,
and must be at most 250 characters long. This keeps a count or an estimate tied to the row it
belongs to.

**Loading the files.** The runner refuses a check file whose strings hold a control character,
and compiles every pattern when it loads, before any build is scored.

## Controls

A control entry holds a list in `any`, and passes when one of its descriptions holds. A
description has:

- **`roles`**: Chromium's computed roles, or one of three groups:
  - `action`: `button`, `link` and `menuitem`;
  - `choice`: `action` and `radio`, `option`, `checkbox`, `switch`,
    `menuitemradio`, `menuitemcheckbox` and `tab`;
  - `entry`: `textbox`, `searchbox`, `combobox` and `spinbutton`.
- **`name`**, optional: a regular expression the accessible name must match, ignoring case.
  With no `name`, the control needs a name that is not empty.
- **`near`**, optional: a text that the control's accessible name contains, or that the
  string of an element around the control contains, where that string is worked out as for
  `with` and is at most 250 characters long.
- **`count`**, optional, 1 by default: how many distinct controls must match. In the matching
  below, such an entry takes that many elements.
- **`mayBeDisabled`**, optional, on a description: the control may be disabled, as a control
  that acts on a
  selection is until something is selected.

A control counts when it is in the accessibility tree, is not inside an `inert` or
`aria-hidden` subtree, and is not disabled or `aria-disabled` unless its description says
`mayBeDisabled`. Its box and position are not checked: whether it can be seen and reached is
for the walks.

**One element, one entry.** Within a state, the entries are matched to distinct elements: the
runner finds the largest set of entries that can each be given an element no other entry in the
set uses, and the entries outside that set fail. So one "Add donation" button cannot pass both
"add another row" and "send the batch".

**A known limit.** A menu that creates its items only when it opens has none of them in the
tree, and its entries fail; a menu that keeps its items in the page, hidden from the tree until
it opens, fails too. A field inside a closed disclosure passes. The owner's blind judgement and
the walks see such controls; these checks do not.

## What the checks do not measure

- **Behaviour.** That confirming is what calls `variety-retire`, that a control calls the
  command it names, that focus moves after an action. The walks of steps 0.3 and 0.4 read those
  from the journal.
- **How well a field is shown.** A field in a closed disclosure passes.
- **Copy.** The names are matched by patterns that admit many wordings; only the two confirm
  prompts, which the tasks give word for word, are matched as text.
