# Scales: a rule for sizes, names for purposes, and values derived from one another

## Status

- **State:** scaffold. Written 2026-11-13 against `main` at `e5d683a8`. It states the problem,
  what exists and draft jobs. It has no design, no drafted commands and no scenario files yet.
  [STATUS.md](STATUS.md) tracks progress.
- **Verified:** nothing first-hand. [What exists today](#2-what-exists-today) comes from a survey
  another agent made on 2026-11-13 at `e5d683a8`; each claim names its file.
- **Waiting on the owner.** The owner dislikes size names by position. The direction here (a rule,
  names by purpose, derived values) was put to the owner on 2026-11-12 and is not yet answered.
  Nothing should be designed until it is.

| Field | Value |
| --- | --- |
| Epic | [#1111](https://github.com/lushly-dev/afd/issues/1111) |
| Units likely touched | `foundations/violet`, `integrations/violet-afd`, `endpoints/loam/packages/theme`, possibly `foundations/fast-af/packages/violet-elements` |
| Related | [Patterns](../patterns/patterns.proposal.md), [Design Decisions](../design-decisions/design-decisions.proposal.md) |
| Rank among the four | Fourth. Small, separate, and only Violet and Loam need it |

## 1. Problem

Size names that state a position (`xs` to `xl`, `sm`/`md`/`lg`, 1, 2, 3) do two jobs: they limit
the choices and they relate sizes to each other. They do both badly.

1. **They are seldom semantic.** `space.stack.sm` says where a value sits in a list, not what it
   is for.
2. **Nothing fits between two steps.** A size between `sm` and `md` means renaming, or a name
   like `sm-plus`.
3. **The vocabulary is split.** The library uses `xs` to `xl`, `sm`/`md`/`lg`,
   `compact`/`natural`/`comfortable`, and `small`/`medium`/`large` for padding.
4. **Nothing is derived.** A value meant to be "one step up from" another is a separate literal,
   so changing one leaves the other behind.

The ladder existed partly for human memory. When an agent chooses the value, a rule it can check
matters more than a short list to remember.

## 2. What exists today

### Violet

- **Constraints** (`foundations/violet/packages/core/src/types/constraint.ts`): `enum`, `range`,
  `pattern`, `scale {base, tolerance}`, `contrast` and `reference`, each with a severity and an
  `applyTo` glob. Checks are in `constraints/validators.ts`; `scale` measures the distance to the
  nearest multiple of its base (lines 172 to 210).
- **They are checked, not enforced.** `constraints.validate`, `analyze.violations`,
  `analyze.compliance`, `tokens.matrix` and `changes.impact` run them; writing a token does not.
  The demo system constrains `spacing.*` to multiples of 4
  (`integrations/violet-afd/src/demo/realistic-system.ts:825`).
- **References with a transform are not built.** The shape is `{ref, transform?: string}`,
  commented with `'multiply(1.5)'` and `'add(8px)'` (`packages/core/src/types/token.ts:44-47`).
  Resolving one throws `NOT_IMPLEMENTED` (`engine/resolver.ts:584-590`), and export fails with
  the suggestion to use a literal. There is no grammar and no design note beyond the comment.
- **`scale` knows multiples only.** It has no ratio or list of allowed steps, and derives nothing.

### Loam's token contract

- `endpoints/loam/packages/theme/contract/tokens.json`: 127 tokens.
- **41 are named by position:**
  - `size.font`, `size.line` and `size.space`, `xs` to `xl` (5 each).
  - `space.inline` `sm`/`md`/`lg`, `space.layout` `sm`/`md`, `space.stack` `xs`/`sm`/`md`.
  - `radius` `sm`/`md`/`lg`.
  - Fifteen type tokens such as `type.body.md.size`.
- **The rest are named by purpose,** among them `size.target.compact`/`natural`/`comfortable`
  (24, 32 and 44 px) and every colour.
- **Primitives** are named by their pixel value, `ref.space.{2,4,6,8,12,16,24}`
  (`src/tree/primitives.ts:75-80`). They are not in the contract.
- **Loam's tree declares no Violet constraints.**

### `violet-elements`

- `foundations/fast-af/packages/violet-elements/attribute-taxonomy.jsonc` gives `size` per
  component (lines 419 to 441): `xs` to `xl` on the persona, `sm`/`md`/`lg` on badge, spinner and
  skeleton, and `compact`/`natural`/`comfortable` on the pickers, file upload and swatches.
  `density` (lines 773 to 782) is `compact`/`natural`/`comfortable` and says not to use it for
  `sm`/`md`/`lg`. `padding` (lines 904 to 913) is `none`/`small`/`medium`/`large`.

## 3. Jobs (draft)

For the owner to cut, add and rank, once the owner agrees with the direction.

1. **Add a size between two.** When a new size is needed between two existing ones, I want to add
   a token named for its purpose with a value the rule allows, so that nothing is renamed.
2. **Hear about a value off the rule.** When a value breaks the scale's rule, I want to be told
   when it is checked, with the nearest allowed values, so that the system stays on its rule.
3. **Change a base and have its dependants follow.** When a base value changes, I want values
   derived from it to change with it, so that relationships hold.
4. **Choose by purpose.** When an agent picks a size, I want it to choose by what the size is for,
   so that the choice explains itself.
5. **Refuse a bad derivation.** When a transform is not in the grammar, or references form a
   cycle, I want it refused with the reason, so that no value resolves to nonsense.
6. **Stay quiet about values on the rule.** When a value is on the rule, I want nothing reported
   for it, so that only values off the rule draw attention.

## 4. Starting points

Not a design.

- **The rule:** `scale` already checks multiples of a base. A ratio, or a list of allowed steps,
  would cover type sizes that are not multiples.
- **Derived values:** a small transform grammar (`multiply`, `add`, perhaps `clamp`) on the
  existing reference shape, so the `NOT_IMPLEMENTED` branch becomes real.
- **Loam first:** attach constraints to its tree, then rename its 41 position-named tokens by
  purpose. That is a breaking change to the contract.

## 5. Open questions

1. **The direction itself,** which the owner has not yet answered.
2. **Component attributes:** whether `size="sm"` and `padding="small"` on components are in
   scope, or only tokens.
3. **Enforcement:** whether constraints should block a write, or stay checks.
4. **Type sizes:** whether a ratio rule fits type, or type keeps a list of allowed steps.
5. **Migration:** how Loam's contract changes names without breaking its consumers at once.

## 6. Out of scope

- Colour scales. Colour already uses purpose names throughout Loam's contract.
