# Phase 0: tasks and acceptance procedures

Frozen 2026-11-09, before any guidance was written and before any run, and
kept out of the repository until the last run had finished. Committed
afterwards as the record. It must not be readable by a session that reruns
these tasks (step C5), or by an agent that writes guidance for them.

## What every task says

The same preamble, then the task, then the arm's addition.

> Work in `foundations/fast-af/packages/violet-elements`. Write one new
> file, the path given below, and change no other file. It is a story file
> like the others in `src/`, using `@lushly-dev/specimen/types` and
> `@lushly-dev/specimen/test`. Build the page from this library's
> components wherever one fits, and plain HTML elsewhere. Add no
> dependency. Each named story renders the whole page. When you are done,
> say so and stop; do not run the test suites.

## Task 1: member settings form

File: `src/phase0/member-settings.stories.ts`. Two stories, `Page` and
`Invalid`.

> A form titled "Member settings" with: a required text field "Name"; a
> multi-line field "Bio"; a "Role" choice of Viewer, Editor and Admin, with
> Editor chosen; an "Email notifications" on/off toggle, on; a checkbox "I
> accept the terms"; and two buttons, "Save", which submits the form and is
> the primary action, and "Cancel". Every control takes part in the form
> under a name of its own. A second story, `Invalid`, shows the same form
> with "Name" empty, marked invalid, and the message "Enter a name."

Required parts, by role and accessible name, in the mounted DOM (shadow
roots included):

| Story | Role | Name | Also |
| --- | --- | --- | --- |
| both | `form` or a `form` element | | contains every control below |
| both | `textbox` | Name | required |
| both | `textbox` | Bio | multi-line |
| both | `combobox` or `listbox` | Role | three options named Viewer, Editor, Admin; Editor selected |
| both | `switch` | Email notifications | checked |
| both | `checkbox` | I accept the terms | |
| both | `button` | Save | |
| both | `button` | Cancel | |
| `Invalid` | `textbox` | Name | `aria-invalid="true"`, and the text "Enter a name." on the page |

Form participation: `new FormData(form)` on `Page` has an entry for the
name, bio, role and notifications controls.

## Task 2: project actions and delete confirmation

File: `src/phase0/project-actions.stories.ts`. Stories `Closed` and
`ConfirmOpen`.

> A toolbar with a button "Actions" that has a leading icon and opens a
> menu of three items: Rename, Duplicate and Delete. Beside it, an
> icon-only button whose purpose is "Help", which shows the text "Deleting
> a project cannot be undone." when the user asks for it. Choosing Delete
> opens a confirmation dialog titled "Delete project?" with the text "This
> removes the project and its files." and two buttons, "Cancel" and
> "Delete". `Closed` shows the page as it loads. `ConfirmOpen` shows it
> with the confirmation dialog open.

Required parts:

| Story | Role | Name | Also |
| --- | --- | --- | --- |
| both | `button` | Actions | contains an icon element that is hidden from the accessibility tree or has no name of its own |
| both | `button` | Help | no visible text |
| both | `menuitem` ×3 | Rename, Duplicate, Delete | present in the DOM, open or not |
| `Closed` | `dialog` or `alertdialog` | | none open |
| `ConfirmOpen` | `dialog` or `alertdialog` | Delete project? | open; contains the text and buttons "Cancel" and "Delete" |

## Task 3: project browser

File: `src/phase0/project-browser.stories.ts`. One story, `Page`.

> A page with: a breadcrumb of three levels, Home, Projects and "Atlas",
> where Atlas is the current page; a tree with two folders, "src",
> expanded, holding "index.ts" and "app.ts" with "app.ts" selected, and
> "docs", collapsed; and three tabs, Files, Activity and Settings, with
> Activity selected. The Activity tab shows a count of 3. The Activity
> panel is an empty state that says "No activity yet" and offers a button
> "Invite a teammate". The Files panel shows that it is loading.

Required parts:

| Role | Name | Also |
| --- | --- | --- |
| `navigation` | any | contains links or items Home, Projects, Atlas; Atlas has `aria-current="page"` |
| `tree` | any | |
| `treeitem` | src | `aria-expanded="true"` |
| `treeitem` | index.ts | |
| `treeitem` | app.ts | `aria-selected="true"` or `aria-current` |
| `treeitem` | docs | `aria-expanded="false"` |
| `tablist` | any | |
| `tab` ×3 | Files, Activity, Settings | Activity has `aria-selected="true"`; its name or description includes 3 |
| `tabpanel` | Activity | visible; contains "No activity yet" and a `button` "Invite a teammate" |
| `progressbar` or `status` | any | inside the Files panel, in the DOM |

## Arm additions

- a: nothing.
- b: "Before you write, read the whole file at `<path>`. It describes
  every component in this library."
- c: "Before you write, run `<brief command> <the tags you will use>` once
  for the whole page, and work from its answer."
- d: "After you write, run `<check command> <your file>` and fix what it
  reports."
- e: both c's and d's sentences.

## Check procedures

A harness runs each produced file through Specimen (`run`, by file, with
the settled accessibility check the package already turns on) and reads
the mounted DOM once per story.

1. **Complete.** Every row of the task's table holds. Roles and names are
   computed (the accessibility tree), not read from attributes. Fail on the
   first missing row; record all missing rows.
2. **Mounts.** Every story of the file runs to its end with no console
   error and no uncaught error. An accessibility failure alone does not
   fail this check.
3. **Accessible.** The settled accessibility report has no violation, in
   every story.
4. **In the manifest.** For every element whose tag starts with `violet-`:
   the tag is in `custom-elements.json`; every attribute it carries is one
   the manifest declares for it, or is on this list: `id`, `class`,
   `slot`, `style`, `hidden`, `tabindex`, `title`, `lang`, `dir`, `role`,
   `part`, `inert`, any `aria-*`, any `data-*`; and where the manifest's
   type for an attribute is a union of string literals, the value is one
   of them. Attributes a component sets on itself count like any other, so
   the same check is first run on the library's own stories for the tags
   involved, and whatever those show is added to the allowed list before
   any run. Count the violations; pass at zero. Properties set in code are
   not seen by this check.
5. **Taxonomy.** A fresh reviewer gets the produced file and
   `attribute-taxonomy.jsonc`, and nothing else. It lists each use of an
   attribute that the entry's `doNotUseFor` rules out, quoting the line and
   the rule. Count them; pass at zero. Files are given under random names,
   in random order, with no arm named.

## Amendments after the pilot, before any counted run

Two pilot sessions (task 1 arm a, task 2 arm e; neither is counted) showed
where a frozen procedure could not be carried out as written. None of these
depends on the guidance, and all were made before the 75 runs started.

- **Task 1, Role.** A `radiogroup` named Role with the three choices is
  accepted beside `combobox` and `listbox`: the task asks for "a choice".
  The three option names are read from the DOM, since a closed select does
  not expose its options to the accessibility tree.
- **Task 1, form participation.** The harness does not run script in the
  page, so `FormData` is replaced by: at least four distinct `name`
  attributes on form-associated elements (radios inside a group counted
  once).
- **Task 1, required and invalid.** Read from attributes in the mounted DOM
  (`required` or `aria-required`; `aria-invalid="true"`), not tied to the
  Name field by the accessibility tree.
- **Task 2, the open dialog.** With a modal dialog open, Specimen's ARIA
  snapshot of the story root was empty (at `cfb70942`; fixed since by #915). `ConfirmOpen` is therefore read from
  the DOM: a dialog element with `open`, and the title, text and both button
  labels in the markup. The Actions and Help buttons are required in
  `Closed` only. The menu items are read from the DOM in both.
- **Task 2, the icon.** "An icon element exists" (`violet-icon` or `svg`),
  and the button's accessible name is exactly "Actions".
- **Task 3.** The current breadcrumb level is "some element has
  `aria-current="page"`" plus the three names inside a `navigation`. The
  loading indicator is any spinner, progress or skeleton element, or a
  `progressbar` or `status` role, anywhere in the DOM: a hidden panel is not
  in the accessibility tree. A tab matches when its name starts with the
  label, so a count in the name does not hide it.
- **Check 4, calibration.** The library's own 407 stories carry four
  attribute uses the manifest does not declare (`violet-button value`,
  and three on `violet-data-grid`). They are allowed.
