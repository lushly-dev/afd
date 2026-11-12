# Component pack format, version 0

A component pack tells an agent what it needs to use a library's components:
each component's attributes, slots, events and accessibility facts, the
guidance written for it, and the rules the library states once for many
components. Every fact says where it came from. Specimen builds packs from
what it observes when it runs a library's stories (`bench.pack()`; see
[How Specimen builds a pack](#how-specimen-builds-a-pack)), and an Umbel plugin
serves them in batches. The plan is the
[Component Briefs proposal](https://github.com/lushly-dev/afd/blob/main/docs/features/active/component-briefs/component-briefs.proposal.md).

**Version 0 can change in any release.** It becomes version 1 once Specimen
builds packs and the plugin has served them (the proposal's step C4). Until
then, write packs only to try the format.

The package exports it in two ways:

- `@lushly-dev/specimen/pack`: the Zod schemas, `checkPack`, the catalog
  writer and the helpers below.
- `@lushly-dev/specimen/pack/<kind>.schema.json`: a JSON Schema (draft
  2020-12) for each file kind, `component`, `rules` and `library`, for
  readers in other languages and for editors. A JSON Schema checks one file;
  the rules that span files are `checkPack`'s alone (see
  [Checking a pack](#checking-a-pack)).

## Layout and forms

```text
<pack root>/
├── data/<library>/library.json          # exported form only: the catalog and stamp
├── data/<library>/components/<tag>.json # one record per component
└── rules/<library>.json                 # the library's shared rules
```

A pack can hold several libraries side by side. A `pack.toml` at the root
belongs to the deployment that serves the pack, not to the format, and a check
skips it. Any other file, and any file whose library or tag in its path fails
its pattern, is a `LAYOUT_INVALID` problem. The format sets no limit on the
number of files; a reader applies its own (Umbel's is 1 000 files a pack).

**The committed form** is the records and the rules. A library commits them
to its repository. They carry no package version, no digest and no Git
revision, so a version bump changes none of them, and two branches that change
different components change different files.

**The exported form** adds one catalog per library, `library.json`, and is
what a deployment copies. It names the package and its version, the pack's
digest and each record's digest. It is written at export and not committed.

## Identifiers

An identifier is a value a reader may show outside the part of an answer it
labels as content, so each kind has a pattern. What a pattern guarantees is a
short ASCII alphabet with no spaces, quotes, brackets or control characters,
and a bounded length. It does not stop words joined by hyphens, so a reader
still treats an identifier as data, never as an instruction. A record with an
identifier that fails its pattern is refused (`IDENTIFIER_INVALID`). The
patterns are exported as `PACK_PATTERNS`. Every one is ASCII-only, with no
`\d`, `\w` or `\s`, so it means the same in ECMAScript and in Rust's `regex`
crate.

| Kind | Pattern | Longest |
| --- | --- | --- |
| Library id | `^[a-z][a-z0-9-]{0,63}$` | 64 |
| Tag, a custom-element name | `^[a-z][a-z0-9._]*-[a-z0-9._-]*$` | 100 |
| Element a slot accepts | `^[a-z][a-z0-9._-]*$` | 100 |
| Tag prefix | `^[a-z][a-z0-9._]*-$` | 32 |
| Statement or rule id | `^[a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+$` | 128 |
| Version | Semantic Versioning 2.0.0 | 64 |
| Digest | `^sha256:[0-9a-f]{64}$` | 71 |
| Git revision | 40 or 64 lowercase hex digits | 64 |
| Package name | npm's, with an optional scope | 214 |
| Import specifier | a package name and an optional subpath | 256 |
| Story id | `^[a-z0-9][a-z0-9._-]*$` | 200 |
| Attribute | `^[a-z][a-z0-9_.:-]*$` | 100 |
| Property | a JavaScript identifier | 100 |
| Slot | empty for the default slot, or `^[A-Za-z][A-Za-z0-9_.:-]*$` | 100 |
| Event | `^[A-Za-z][A-Za-z0-9_.:-]*$` | 100 |
| Command | `^(?:--)?[a-z][a-z0-9-]*$` | 100 |
| CSS custom property | `^--[A-Za-z0-9_-]+$` | 100 |
| State | `^[a-z][a-z0-9-]*$` | 64 |
| ARIA role | `^[a-z]+$` | 32 |
| axe rule | `^[a-z0-9-]+$` | 64 |

## Text

Text is content: a reader serves it only inside the part of an answer
labelled as content, never as instructions. Each kind of text has a limit, in
Unicode code points (`PACK_TEXT_LIMITS`), so a reader can fit a budget by
dropping whole facts and never has to cut one.

| Text | Longest | Lines |
| --- | --- | --- |
| Summary, accessible name | 160 | one |
| Statement, rule, description, type, event detail | 240 | one |
| Library title | 80 | one |
| A string value or default | 200 | one |
| An example's markup | 4 000 | several |
| A record's long form, `detail` | 8 000 | several |

A one-line text has no control character (C0, DEL or C1), no line break, no
bidirectional embedding, override or isolate (U+202A to U+202E, U+2066 to
U+2069) and no lone surrogate (`TEXT_INVALID`). A text of several lines may
also hold line feeds and tabs. Over its limit, a text is `TEXT_TOO_LONG`. Text
is never empty, except that a string value or default may be `""`.

## Basis

Every fact carries one of four words saying where it came from. The first
three are Specimen's coverage levels.

| Basis | Meaning |
| --- | --- |
| `verified` | A claim's expectations ran and held, about this fact, in this state. For a statement: the check its claim carries ran and held |
| `observed` | Specimen saw it in a case that passed: an attribute's state, a role, an axe result, an example's markup |
| `declared` | The custom elements manifest or a plugin's schema says so; nothing ran it |
| `authored` | A person wrote it; nothing checks it |

`verified` means that the check tied to a fact ran and passed in the run
that built the pack. Whether the check tests what a statement says is the
author's judgement, as with any test.

Each kind of fact allows only the words that can be true of it:

| Fact | Allowed |
| --- | --- |
| Attribute, value, slot, event, command, CSS property, form association | `verified`, `observed`, `declared` |
| Statement, shared rule | `verified`, `authored` |
| Role | `observed`, `authored` |
| axe result, example | `observed` |

A summary and a record's long form are descriptions, not facts, and carry no
basis.

## Component record

`data/<library>/components/<tag>.json`. Every key below is allowed and no
other (`SCHEMA_INVALID`).

| Key | Holds |
| --- | --- |
| `format` | `0` |
| `tag` | The custom-element name; equal to the file's name (`TAG_MISMATCH`) |
| `summary` | Optional: one line on what it is for |
| `status` | `stable`, `preview` or `deprecated` |
| `replacedBy` | Optional, and only when `deprecated`: the tag to use instead, in the same library |
| `import` | Optional: the specifier that registers it |
| `api.attributes` | `name`, optional `property`, `type`, `description`, `values` (each a value and its basis), `default`, `rules` (shared rule ids), and `basis` |
| `api.slots` | `name` (empty for the default slot), optional `description`, `accepts` (element names), `basis` |
| `api.events` | `name`, optional `description` and `detail` (the type of `event.detail`), `basis` |
| `api.commands` | `name` (a `command` value its invoker can send), optional `description`, `basis` |
| `api.cssProperties` | `name`, optional `description` and `default`, `basis` |
| `api.form` | Optional: `associated` and `basis` |
| `a11y.role` | Per state: `state`, `role`, optional `name` (how it gets its accessible name), `basis` |
| `a11y.statements` | Accessibility statements: `id`, `text`, `basis` |
| `a11y.axe` | Optional: `violations` (a count), `exceptions` (axe rule ids not run), `basis` |
| `usage` | Statements on when and how to use it: `id`, `text`, `basis` |
| `rules` | The shared rules that apply to it, by id |
| `examples` | `from` (the story that rendered it), `html` (the markup that rendered), `basis` |
| `detail` | Optional: the long form |
| `gaps` | What is missing: `summary`, `usage`, `a11y-statement`, `role`, `example`, or `unobserved` with the `section` and `name` of a member the manifest declares and no case showed |

Values and defaults are strings, integers between −(2⁵³ − 1) and 2⁵³ − 1,
booleans or `null`. No other number is allowed, so every reader writes
numbers the same way. An attribute's `values` lists a finite set; an
open-ended attribute has none.

## Shared rules

`rules/<library>.json`: `format`, `library` (equal to the file's name,
`LIBRARY_MISMATCH`) and `rules`. A rule is stated once and says what it
applies to.

| Key | Holds |
| --- | --- |
| `id` | Its id, unique in the library together with every statement id (`DUPLICATE_ID`) |
| `text` | The rule |
| `appliesTo` | `tags`, `attributes` or both: the components it names, and any component with a named attribute. At least one, and neither empty |
| `basis` | `verified` or `authored` |

A record that names a rule the file does not state is `RULE_UNKNOWN`; a rule
that names a tag with no record is `TAG_UNKNOWN`.

Ids are unique within a library, not across a pack: libraries are written and
exported separately, and two may choose the same id. A reader that names ids
from more than one library qualifies each as `<library>/<id>`; neither
pattern contains `/`.

## Catalog

`data/<library>/library.json`, in the exported form only.

| Key | Holds |
| --- | --- |
| `format` | `0` |
| `library` | The library id, equal to its directory's name |
| `title` | The library's name, as text |
| `package` | `name` and `version` of the package that ships the components |
| `prefix` | The tag prefix; every listed tag starts with it (`PREFIX_MISMATCH`) |
| `revision` | Optional: the Git revision export ran on |
| `digest` | The pack digest, below |
| `rules` | The rules file's digest |
| `components` | One entry per record: `tag`, `summary`, `status` and `digest`, the summary and status equal to the record's |

It names no Specimen version, so an export of the same records is the same
file whatever Specimen wrote it.

**Digests.** A file's digest is `sha256:` and the SHA-256 of its bytes. The
pack digest of a library is the digest of one line per committed file of
that library, `<path> <digest>` and a line feed, sorted by path, where the
path is relative to the pack's root. It covers the rules and every record and
not the catalog. A record listed and missing, or present and not listed, is
`CATALOG_MISMATCH`; any digest that does not match is `DIGEST_MISMATCH`,
which is what a hand-edited or half-copied export looks like.
`packContentDigest` computes it, and `packCatalog` writes the whole catalog
from the committed files and a stamp.

## Canonical bytes

Each file has exactly one serialization (`canonicalJson`, which is
`JSON.stringify` with sorted keys):

- UTF-8, with no byte order mark (a file that starts with one is
  `JSON_INVALID`).
- Keys sorted at every depth by UTF-16 code unit, which for the format's
  ASCII keys is byte order.
- Each object member and array element on its own line, indented one tab per
  depth; `": "` between a key and its value; `[]` and `{}` when empty; a
  final line feed.
- Strings escaped as `JSON.stringify` escapes them: `\"` and `\\`; tab and
  line feed as `\t` and `\n` (the only control characters text may hold);
  everything else, `/` and non-ASCII included, written as itself.
- Integers in decimal, with no sign on zero, no exponent and no fraction.

Lists of named
things are in ascending order with no repeats: a record's attributes, slots,
events, commands and CSS properties by name; its roles by state; its rule
ids, an attribute's rule ids, a slot's accepted elements and the axe
exceptions; a rules file's rules by id and each rule's tags and attributes;
a catalog's components by tag, each compared by UTF-16 code unit (byte order
for these ASCII names). Statements, values, examples and gaps keep the
order they are written in. Anything else is `NOT_CANONICAL`, and a repeat is
`DUPLICATE_ID`.

So two builds from the same inputs are the same bytes, and a change to a
record is a change to one file.

## Checking a pack

`checkPack(files, { form })` takes a pack's files by relative path
(`readPackFiles(root)` reads a directory) and returns every problem it finds,
each with a code, the file, and a JSON Pointer when the problem is at one
place in it.

| Code | Problem |
| --- | --- |
| `LAYOUT_INVALID` | A file the format does not define, a library with no rules file, a catalog in the committed form or none in the exported form |
| `JSON_INVALID` | Not UTF-8 JSON |
| `FORMAT_UNSUPPORTED` | Not a JSON object, or a `format` missing or other than 0; nothing else in the file is checked |
| `SCHEMA_INVALID` | A missing or unknown key, a wrong type, a basis the fact does not allow, a replacement for a component that is not deprecated, a gap with the wrong keys |
| `IDENTIFIER_INVALID` | An identifier that fails its pattern or is too long |
| `TEXT_TOO_LONG`, `TEXT_INVALID` | See [Text](#text) |
| `NOT_CANONICAL` | Not the canonical bytes, or a list out of order |
| `DUPLICATE_ID` | A repeated name in a list, or a statement or rule id stated twice in a library |
| `RULE_UNKNOWN`, `TAG_UNKNOWN` | A reference to a rule or tag the library does not have |
| `TAG_MISMATCH`, `LIBRARY_MISMATCH` | A tag or library id that is not its file's or directory's name |
| `PREFIX_MISMATCH` | A listed tag that does not start with the catalog's prefix |
| `CATALOG_MISMATCH` | The catalog and the records disagree on which tags exist or on a summary or status |
| `DIGEST_MISMATCH` | A record, the rules or the pack does not match its digest |

A problem's message never quotes text from the pack. A path the layout does
not place is shown only up to its first segment that is not a plain name
(letters, digits, `.`, `_` and `-`), which is replaced, with the rest, by `…`.

The JSON Schema files cover, one file at a time, what Zod checks within a
file: `FORMAT_UNSUPPORTED`, `SCHEMA_INVALID`, `IDENTIFIER_INVALID`,
`TEXT_TOO_LONG` and `TEXT_INVALID` (except a lone surrogate, which a JSON
Schema pattern cannot see). The rest need the layout, the bytes or more than
one file, and are `checkPack`'s.

## How Specimen builds a pack

`bench.pack()` builds a record for every component whose tag starts with the
configured prefix, from three sources: the schemas (the manifest and the
plugins' schema sources), the captures of the cases that passed in both of its
passes, and the guide files. A case that failed, or showed something different
in each pass, contributes nothing. The rules below are Specimen's; another
writer of the format may choose its own.

- **Attributes** are the members a capture can read through an attribute; a
  property with no attribute has no entry. A value's basis is its coverage
  level: `verified` from a claim, `observed` when a case showed it, `declared`
  otherwise. An attribute's own basis is the best its values earned in a state
  other than its default, so a boolean is `observed` once a case showed it set.
  An open-ended attribute is `observed` when a case showed it with a value
  other than its default. A finite set is listed in `values`, except `true`
  and `false` alone. `rules` are the shared rules that name the attribute.
- **Slots** take the better of their filled and empty levels; `accepts` lists
  the library's elements a case showed assigned to the slot. **Events** and
  **commands** take their coverage level, and **CSS properties** are
  `declared`. `form` is present, `observed`, when a case showed the element
  form-associated, and `verified` when a claim proved its participation.
- **Roles.** In the default state, every instance a case showed has to have
  the same computed role (capture 0.9); the role is then `observed`. Its
  `name` says how the name was given when every instance agrees: `from the
  <attribute> attribute` when an attribute holds the name, `from its text`
  otherwise, and nothing when the element names others with
  `aria-labelledby`. A guide's `roles` give the roles of other states, which
  stay `authored`, and a guide's default-state role only where none was
  observed.
- **The accessibility check** counts for the component a case is about, the
  one the entry names: `violations` is how many axe rules failed across those
  cases, and `exceptions` the rules a native specimen's policy excused.
- **Statements and rules** come from the guide files, `verified` when a claim
  with its check held in `guides@1`, `authored` otherwise. A record's `rules`
  are those that name its tag or one of its attributes.
- **Examples** come from the cases that name the component: the light DOM the
  case mounted, with shadow content left out and an empty attribute written as
  its name. One is kept only when it is the same in both passes, fits 4 000
  characters, and, mounted on its own after the case's module has loaded,
  shows the same elements, states and roles. At most three are kept, the first
  by case id.
- **Gaps** list, in this order, a missing summary, usage statement,
  accessibility statement, role and example, then each attribute and slot
  whose basis is `declared`.
- A manifest's text is written on one line, with its whitespace collapsed;
  one over its limit, or holding a control character, is left out and
  reported, and so is an identifier the format does not allow.

`bench.packCheck()` builds the same way and compares; `bench.packExport()`
rechecks, without a browser, what the manifest and the guide files alone say.
`fixtures/pack-library/` is the example library: built, it gives
`fixtures/pack/committed/` byte for byte, and exported, `fixtures/pack/exported/`.

## Fixtures

`fixtures/pack/` in Specimen's source holds the format's test packs.

- `committed/` and `exported/`: an example library, `example`, in both
  forms. `example-field`, `example-option` and `example-select` are in use,
  and `example-dropdown` is deprecated and names its replacement. Every key a
  record can hold, every basis, every kind of gap and a record with no
  summary each appear at least once.
- `invalid/`: one case per directory, and `invalid/cases.json` naming each.
  A case is the exported example with its directory's files laid over it and
  the files in its `remove` list deleted; a case that only deletes has no
  directory. `problems` lists, in order, every problem `checkPack` reports
  for it. Where `regenerated` is true, the case's catalog is the one export
  would write for its files, so the catalog is not a second defect.

Specimen's tests check that both valid forms pass, that the exported catalog
is the one `packCatalog` writes, that each case yields exactly its
`problems`, and that the committed JSON Schema files are the ones the
package generates and accept the example.
