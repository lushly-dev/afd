# Pipeline variable references

Normative behavior for variable references in pipeline step inputs and `when` conditions
(`afd-pipe`, `executePipeline`, `DirectClient.pipe`). TypeScript, Python and Rust must implement
exactly this. The pipeline request comes from an untrusted client, so resolution must never reach
anything but pipeline data.

## Reference syntax

A step input value is a **reference** only when the **entire string** matches one of these forms.
References are not interpolated inside longer strings.

| Form | Resolves to |
| --- | --- |
| `$prev` / `$prev.<path>` | `data` of the previous step |
| `$first` / `$first.<path>` | `data` of the first step |
| `$steps[N]` / `$steps[N].<path>` | `data` of step `N` (0-based) |
| `$steps.<alias>` / `$steps.<alias>.<path>` | `data` of the step whose `as` is `<alias>` |
| `$input` / `$input.<path>` | the pipeline request's own `input` field |

`<path>` is a sequence of segments separated by `.`. A segment is either a key (`user`) or a key
followed by an index (`items[2]`). A purely numeric segment (`items.2`) indexes an array.

## Literals and escaping

- A string that starts with `$` but does not match a form above (for example `$9.99`, `$HOME`,
  `$prevx`) is a **literal** and passes through unchanged.
- A string that starts with `$$` is always a literal with one leading `$` removed:
  `"$$prev"` becomes `"$prev"`. This is how a client sends a literal that looks like a reference.

## What a path may reach

Resolution operates on **JSON data only**:

1. Step data is viewed as JSON before traversal: language-native objects such as Pydantic models,
   dataclasses and serde structs are converted to their JSON representation first. Resolution never
   reads object attributes, methods, prototypes or language internals.
2. A key segment resolves only to an **own key** of a JSON object. Inherited or prototype
   properties never match.
3. A segment beginning with `__` never resolves, whatever the data contains.
4. An index resolves only when it is within the bounds of a JSON array.

`$input` refers to the `input` field of the pipeline request. It is never the host's execution
context (trace IDs, auth, or other values a host passes to its executor).

## Unresolved references

If a reference cannot be resolved (unknown alias, index out of bounds, missing key, skipped or
failed step, `__` segment, no request `input`), it resolves to **absent**:

- as an object property value, the property is omitted from the step input;
- as an array element, it becomes `null`.

In `when` conditions, an unresolved reference is absent: `$exists` is `false`, and comparisons with
absent operands are `false`.

## Resolution details

- `$prev` is the `data` of the most recent **successful** step, not simply the previous step.
- A key contains any characters except `.`, `[`, `]` and whitespace. Each segment has at most one
  `[N]` suffix. A string using any other syntax is a literal: for example `$prev.a b`,
  `$steps[0][1]` and `$steps.user[0]`.
- A purely numeric segment is an own-key lookup on an object and an index on an array.
- The `__` rule applies to aliases too: `$steps.__proto__` is unresolved.
- `$$` unescaping applies at any string length. The 1024-character limit applies only to strings
  that would otherwise be references.
- `$exists` is `false` for `null` as well as absent values.
- `$eq` and `$ne` compare **JSON values structurally** (deep equality of objects and arrays).
  Objects are never compared by identity.

## Limits

- Step inputs, and the request `input`, nested deeper than **64** levels are rejected before any
  step runs. The outermost object or array counts as level 1. The pipeline returns a
  `VALIDATION_ERROR` failure and never overflows the stack.
- A reference string longer than **1024** characters is a literal (it is never resolved).

## Conformance

Each implementation has tests for every rule above. At minimum, the tests cover:

- the forms;
- `$9.99`, `$$prev`, a `__proto__`/`__class__`/`constructor` path;
- an out-of-bounds index;
- `$input` with and without a request `input`;
- an unresolved alias;
- 65-level nesting;
- `when` over an unresolved path.
